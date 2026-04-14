#!/usr/bin/env python3
import json
from datetime import UTC, datetime
from pathlib import Path

from facial_geometry_utils import detect_face_geometry_from_path, write_geometry_file


ROOT_DIR = Path(__file__).resolve().parent.parent
STYLES_DIR = ROOT_DIR / "styles"
BLURRED_DIR = ROOT_DIR / "blurred"
CACHE_DIR = ROOT_DIR / "face-geometry"
MANIFEST_PATH = CACHE_DIR / "manifest.json"
BLURRED_MANIFEST_PATH = BLURRED_DIR / "manifest.json"
VALID_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def load_blurred_manifest():
    if not BLURRED_MANIFEST_PATH.exists():
        return []

    with BLURRED_MANIFEST_PATH.open("r", encoding="utf-8") as manifest_file:
        parsed = json.load(manifest_file)

    return parsed if isinstance(parsed, list) else []


def get_blurred_variant_map():
    blurred_manifest = load_blurred_manifest()
    variant_map = {}

    for item in blurred_manifest:
        source = str(item.get("source") or "").strip()
        output = str(item.get("output") or "").strip()

        if not source or not output:
            continue

        variant_map[source.lower()] = output

    for blurred_path in BLURRED_DIR.iterdir():
        if blurred_path.is_file() and blurred_path.suffix.lower() in VALID_EXTENSIONS:
            variant_map.setdefault(blurred_path.name.lower(), blurred_path.name)

    return variant_map


def build_cache_records():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    blurred_variant_map = get_blurred_variant_map()
    manifest_entries = []
    failures = []

    for style_path in sorted(STYLES_DIR.iterdir(), key=lambda path: path.name.lower()):
        if not style_path.is_file() or style_path.suffix.lower() not in VALID_EXTENSIONS:
            continue

        geometry_filename = f"{style_path.name}.json"
        geometry_path = CACHE_DIR / geometry_filename

        try:
            face = detect_face_geometry_from_path(str(style_path))
            payload = {
                "filename": style_path.name,
                "sourceImage": f"styles/{style_path.name}",
                "face": face,
                "blurredVariant": blurred_variant_map.get(style_path.name.lower(), "")
            }
            write_geometry_file(str(geometry_path), payload)
            manifest_entries.append({
                "filename": style_path.name,
                "geometryFile": geometry_filename,
                "geometryPath": f"face-geometry/{geometry_filename}",
                "sourceImage": f"styles/{style_path.name}",
                "blurredImage": f"blurred/{payload['blurredVariant']}" if payload["blurredVariant"] else "",
                "linkedBlurredFilename": payload["blurredVariant"]
            })
            print(f"Cached face geometry for {style_path.name}")
        except Exception as error:
            failures.append({
                "filename": style_path.name,
                "error": str(error)
            })
            print(f"Failed to cache face geometry for {style_path.name}: {error}")

    manifest_payload = {
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "stylesCount": len(manifest_entries),
        "failureCount": len(failures),
        "entries": manifest_entries,
        "failures": failures
    }
    write_geometry_file(str(MANIFEST_PATH), manifest_payload)
    return manifest_payload


def main():
    manifest_payload = build_cache_records()
    print(
        json.dumps(
            {
                "ok": manifest_payload["failureCount"] == 0,
                "stylesCount": manifest_payload["stylesCount"],
                "failureCount": manifest_payload["failureCount"],
                "manifestPath": str(MANIFEST_PATH)
            },
            ensure_ascii=False
        )
    )


if __name__ == "__main__":
    main()
