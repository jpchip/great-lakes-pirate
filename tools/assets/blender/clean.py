"""Headless Blender clean step for AI-generated meshes (plan 14 §7, spike S4).

Run it through the wrapper, which reads the asset's hints and writes the palette file:

    node tools/assets/build-hull.ts raw-assets/ships/schooner-t1

or directly:

    blender -b --factory-startup -P tools/assets/blender/clean.py -- \
        --input raw.glb --output cleaned.glb --report report.json \
        --length 30 --draft 2.4 --max-tris 11000 --bow auto \
        --palette palette.json [--strip-above 3.5] [--keep-texture]

Steps, all scripted (no manual Blender work):
  1. import (glb/gltf/obj/fbx) and join every mesh into one object
  2. merge by distance
  3. delete loose junk: islands with under --min-island of the biggest island's vertices
  4. orient: up stays up, the hull's long axis goes to Blender +Y (glTF -Z), bow first.
     The bow is the narrower end unless --bow says otherwise
  5. scale to --length on the long axis; put the waterline at z = 0 with --draft below it
  6. optionally strip anything above --strip-above meters (masts, rigging Meshy invented)
  7. palette-ize: each face takes the nearest palette color to its texture color, written
     as vertex colors, and the texture is dropped (unless --keep-texture)
  8. voxel remesh if the surface is badly non-manifold, carrying the colors across
  9. decimate to --max-tris
 10. export glb (+Y up), and a JSON report of what each step did
"""

import argparse
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--length", type=float, required=True, help="target length, meters")
    p.add_argument("--draft", type=float, required=True, help="keel depth below the waterline")
    p.add_argument("--max-tris", type=int, required=True)
    p.add_argument("--bow", choices=["auto", "+y", "-y"], default="auto")
    p.add_argument("--palette", required=True, help="JSON: {name: [r, g, b]} in 0..1 sRGB")
    p.add_argument("--strip-above", type=float, default=None)
    p.add_argument("--min-island", type=float, default=0.01)
    p.add_argument("--keep-texture", action="store_true")
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path):
    lower = path.lower()
    if lower.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    elif lower.endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=path)
    elif lower.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        raise SystemExit(f"Unsupported input format: {path}")


def join_meshes():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("No mesh in the input")
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # Bake parent transforms (glTF imports often parent under an empty) into the mesh.
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def remove_small_islands(obj, min_fraction):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    islands = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        island = []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            island.append(cur)
            for e in cur.link_edges:
                other = e.other_vert(cur)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
        islands.append(island)
    # Relative to the biggest island, so a mesh split into many parts never loses all of them.
    biggest = max((len(i) for i in islands), default=0)
    junk = [i for i in islands if len(i) < biggest * min_fraction]
    bmesh.ops.delete(bm, geom=[v for i in junk for v in i], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    return {"islands": len(islands), "removed": len(junk)}


def non_manifold_ratio(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bad = sum(1 for e in bm.edges if not e.is_manifold)
    ratio = bad / max(1, len(bm.edges))
    bm.free()
    return ratio


def merge(obj):
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def remesh_if_torn(obj):
    """Voxel remesh AI meshes with torn surfaces, carrying the palette colors across."""
    ratio = non_manifold_ratio(obj)
    if ratio <= 0.05:
        return {"nonManifoldRatio": round(ratio, 4), "remeshed": False}
    source = obj.copy()
    source.data = obj.data.copy()
    bpy.context.scene.collection.objects.link(source)
    mod = obj.modifiers.new("remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = max(obj.dimensions) / 400
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # The remesh drops corner colors; project them back from the copy.
    color = obj.data.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    obj.data.color_attributes.active_color = color
    transfer = obj.modifiers.new("colors", "DATA_TRANSFER")
    transfer.object = source
    transfer.use_loop_data = True
    transfer.data_types_loops = {"COLOR_CORNER"}
    transfer.loop_mapping = "POLYINTERP_NEAREST"
    bpy.ops.object.modifier_apply(modifier=transfer.name)
    bpy.data.objects.remove(source, do_unlink=True)
    return {"nonManifoldRatio": round(ratio, 4), "remeshed": True}


def world_verts(obj):
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def orient(obj, bow):
    """Rotate about Z so the long horizontal axis lies along Y, bow toward +Y."""
    verts = world_verts(obj)
    n = len(verts)
    cx = sum(v.x for v in verts) / n
    cy = sum(v.y for v in verts) / n
    sxx = sum((v.x - cx) ** 2 for v in verts) / n
    syy = sum((v.y - cy) ** 2 for v in verts) / n
    sxy = sum((v.x - cx) * (v.y - cy) for v in verts) / n
    # Principal axis of the 2x2 covariance, as an angle from +X.
    angle = 0.5 * math.atan2(2 * sxy, sxx - syy)
    # Rotate that axis onto +Y.
    rot = Matrix.Rotation(math.pi / 2 - angle, 4, "Z")
    obj.matrix_world = rot @ obj.matrix_world
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    verts = world_verts(obj)
    ys = [v.y for v in verts]
    lo, hi = min(ys), max(ys)
    span = hi - lo

    def width_near(y0, y1):
        xs = [v.x for v in verts if y0 <= v.y <= y1]
        return (max(xs) - min(xs)) if xs else 0.0

    # Schooner bows are pointed and sterns are a wide transom, so the narrow end is the bow.
    aft = width_near(lo, lo + 0.12 * span)
    fwd = width_near(hi - 0.12 * span, hi)
    detected = "+y" if fwd <= aft else "-y"
    chosen = detected if bow == "auto" else bow
    if chosen == "-y":
        obj.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ obj.matrix_world
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return {"pcaAngleDeg": round(math.degrees(angle), 2), "bowDetected": detected, "bow": chosen}


def scale_and_place(obj, length, draft):
    verts = world_verts(obj)
    ys = [v.y for v in verts]
    s = length / (max(ys) - min(ys))
    obj.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    verts = world_verts(obj)
    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]
    # Centered on X and Y; keel at -draft so the waterline is z = 0 (glTF y = 0).
    offset = Vector(
        (-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs) - draft)
    )
    obj.location = offset
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    zs = [v.z + offset.z for v in verts]
    return {"scale": round(s, 5), "height": round(max(zs) - min(zs), 3)}


def strip_above(obj, z_max):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    faces = [f for f in bm.faces if all(v.co.z > z_max for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    return {"facesRemoved": len(faces)}


def decimate(obj, max_tris):
    before = tri_count(obj)
    if before <= max_tris:
        return {"before": before, "after": before}
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max_tris / before * 0.98
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return {"before": before, "after": tri_count(obj)}


def texture_sampler(obj):
    """Returns (pixels, width, height, is_float) of the first image texture in the materials."""
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image is not None:
                img = node.image
                return list(img.pixels[:]), img.size[0], img.size[1], img.is_float
    return None


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def palettize(obj, palette, keep_texture):
    """Nearest palette color per face, written as a corner color attribute."""
    sampler = texture_sampler(obj)
    mesh = obj.data
    names = list(palette.keys())
    # Compare in sRGB, as the palette is written. Byte images (PNG, JPEG) hold sRGB values;
    # float images hold linear ones and are converted per sample.
    targets = [tuple(palette[n]) for n in names]
    attr = mesh.color_attributes.get("Color") or mesh.color_attributes.new(
        "Color", "BYTE_COLOR", "CORNER"
    )
    # Fetch the UV layer only now: adding an attribute can leave older layer references stale.
    attr = mesh.color_attributes[attr.name]
    uv = mesh.uv_layers.active
    counts = {n: 0 for n in names}
    for poly in mesh.polygons:
        color = (0.5, 0.5, 0.5)
        if sampler and uv:
            pixels, w, h, is_float = sampler
            u = sum(uv.data[i].uv.x for i in poly.loop_indices) / poly.loop_total
            v = sum(uv.data[i].uv.y for i in poly.loop_indices) / poly.loop_total
            px = min(w - 1, max(0, int((u % 1.0) * w)))
            py = min(h - 1, max(0, int((v % 1.0) * h)))
            k = (py * w + px) * 4
            color = tuple(pixels[k + j] for j in range(3))
            if is_float:
                color = tuple(linear_to_srgb(c) for c in color)
        best = min(
            range(len(targets)),
            key=lambda i: sum((color[j] - targets[i][j]) ** 2 for j in range(3)),
        )
        counts[names[best]] += 1
        rgb = palette[names[best]]
        # BYTE_COLOR stores sRGB, but .color reads and writes linear values.
        for li in poly.loop_indices:
            attr.data[li].color = (*[srgb_to_linear(c) for c in rgb], 1.0)
    mesh.color_attributes.active_color = attr
    if not keep_texture:
        mat = bpy.data.materials.new("palette")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        vc = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = attr.name
        mat.node_tree.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        mesh.materials.clear()
        mesh.materials.append(mat)
    return {"textured": sampler is not None, "faces": {n: c for n, c in counts.items() if c}}


def export(path):
    common = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=True)
    # The vertex-color option was renamed in Blender 4.2.
    for extra in (
        {"export_vertex_color": "ACTIVE"},
        {"export_colors": True},
        {},
    ):
        try:
            bpy.ops.export_scene.gltf(**common, **extra)
            return
        except TypeError:
            continue


def main():
    args = parse_args()
    with open(args.palette) as f:
        palette = json.load(f)
    report = {"input": args.input, "blender": bpy.app.version_string}
    reset_scene()
    import_any(args.input)
    obj = join_meshes()
    report["trianglesIn"] = tri_count(obj)
    # Merge first: importers split vertices at UV seams, which would look like islands.
    merge(obj)
    report["islands"] = remove_small_islands(obj, args.min_island)
    report["orient"] = orient(obj, args.bow)
    report["place"] = scale_and_place(obj, args.length, args.draft)
    if args.strip_above is not None:
        report["strip"] = strip_above(obj, args.strip_above)
    # Colors come from the texture through the UVs, so palette-ize before a remesh loses them.
    report["palette"] = palettize(obj, palette, args.keep_texture)
    report["topology"] = remesh_if_torn(obj)
    report["decimate"] = decimate(obj, args.max_tris)
    bpy.ops.object.shade_smooth()
    report["trianglesOut"] = tri_count(obj)
    obj.name = "hull"
    export(args.output)
    with open(args.report, "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


main()
