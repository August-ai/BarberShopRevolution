from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


ROOT_DIR = Path(__file__).resolve().parent.parent
STYLES_DIR = ROOT_DIR / "styles"
BLURRED_DIR = ROOT_DIR / "blurred"
MANIFEST_PATH = BLURRED_DIR / "manifest.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()

    with file_path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def load_manifest() -> list[dict[str, str]]:
    if not MANIFEST_PATH.exists():
        return []

    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def detect_primary_face(image_bgr: np.ndarray) -> tuple[int, int, int, int] | None:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"))
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.08,
        minNeighbors=5,
        minSize=(80, 80),
    )

    if len(faces) == 0:
        return None

    return max(faces, key=lambda face: face[2] * face[3])


def build_face_mask(image_shape: tuple[int, int, int], face_box: tuple[int, int, int, int] | None) -> tuple[np.ndarray, str]:
    height, width = image_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)

    if face_box is None:
        center = (width // 2, int(height * 0.38))
        axes = (max(24, int(width * 0.12)), max(30, int(height * 0.14)))
        detection_mode = "fallback"
    else:
        x, y, w, h = face_box
        center = (int(x + (w * 0.5)), int(y + (h * 0.56)))
        axes = (max(18, int(w * 0.33)), max(22, int(h * 0.40)))
        detection_mode = "detected"

    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (31, 31), 0)
    return mask, detection_mode


def lightly_blur_face_in_place(image_path: Path) -> dict[str, str]:
    image = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)

    if image is None:
        raise RuntimeError(f"Unable to read image: {image_path}")

    alpha_channel = None

    if image.ndim == 2:
        image_bgr = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:
        alpha_channel = image[:, :, 3]
        image_bgr = image[:, :, :3]
    else:
        image_bgr = image

    face_box = detect_primary_face(image_bgr)
    mask, detection_mode = build_face_mask(image_bgr.shape, face_box)

    blur_kernel = max(15, int(min(image_bgr.shape[:2]) * 0.045))

    if blur_kernel % 2 == 0:
        blur_kernel += 1

    blurred_bgr = cv2.GaussianBlur(image_bgr, (blur_kernel, blur_kernel), 0)
    mask_float = (mask.astype(np.float32) / 255.0)[:, :, None]
    output_bgr = (blurred_bgr.astype(np.float32) * mask_float) + (image_bgr.astype(np.float32) * (1.0 - mask_float))
    output_bgr = np.clip(output_bgr, 0, 255).astype(np.uint8)

    if alpha_channel is not None:
        output_image = np.dstack((output_bgr, alpha_channel))
    else:
        output_image = output_bgr

    if not cv2.imwrite(str(image_path), output_image):
        raise RuntimeError(f"Unable to write image: {image_path}")

    return {
        "source": image_path.name,
        "output": image_path.name,
        "detectionMode": detection_mode,
        "processedInPlace": "true",
    }


def should_process_image(image_path: Path) -> bool:
    original_path = STYLES_DIR / image_path.name

    if original_path.exists():
        return sha256_file(image_path) == sha256_file(original_path)

    return True


def main() -> None:
    BLURRED_DIR.mkdir(parents=True, exist_ok=True)
    manifest_by_output = {
        entry.get("output", ""): entry
        for entry in load_manifest()
        if isinstance(entry, dict)
    }

    updated_entries: list[dict[str, str]] = []

    for image_path in sorted(BLURRED_DIR.iterdir()):
        if image_path.suffix.lower() not in IMAGE_EXTENSIONS or not image_path.is_file():
            continue

        if should_process_image(image_path):
            entry = lightly_blur_face_in_place(image_path)
            print(f"Blurred {image_path.name} ({entry['detectionMode']}).")
            updated_entries.append(entry)
        else:
            existing_entry = manifest_by_output.get(image_path.name, {
                "source": image_path.name,
                "output": image_path.name,
                "detectionMode": "existing",
                "processedInPlace": "false",
            })
            updated_entries.append(existing_entry)
            print(f"Skipped {image_path.name} (already different from styles source).")

    MANIFEST_PATH.write_text(json.dumps(updated_entries, indent=2), encoding="utf-8")
    print(f"Wrote manifest to {MANIFEST_PATH}.")


if __name__ == "__main__":
    main()
