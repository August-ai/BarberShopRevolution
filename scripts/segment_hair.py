#!/usr/bin/env python3
import argparse
import base64
import io as _io
import json
import os
import sys
import traceback

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def log(message: str) -> None:
    print(message, file=sys.stderr)


def emit_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def fail_and_exit(message: str) -> None:
    emit_json({"error": message})
    log(f"ERROR: {message}")
    sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Segment hair from an image using MediaPipe.")
    parser.add_argument("input_path", help="Path to the source image.")
    parser.add_argument("output_path", help="Path to the output PNG file.")
    parser.add_argument(
        "--model",
        dest="model_path",
        required=True,
        help="Path to the MediaPipe hair segmentation TFLite model."
    )
    return parser.parse_args()


def build_hair_alpha_mask(category_mask: np.ndarray | None) -> np.ndarray:
    if category_mask is None:
        raise RuntimeError("The segmenter did not return a category mask.")

    hair_mask = (category_mask > 0.2).astype(np.float32)
    hair_mask = cv2.GaussianBlur(hair_mask, (15, 15), 0)
    return np.clip(hair_mask, 0.0, 1.0)


def segment_image(input_path: str, output_path: str, model_path: str) -> str:
    bgr_image = cv2.imread(input_path, cv2.IMREAD_COLOR)

    if bgr_image is None:
        raise RuntimeError(f"Could not open input image: {input_path}")

    rgb_image = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB).astype(np.uint8)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image)

    base_options = python.BaseOptions(model_asset_path=model_path)
    options = vision.ImageSegmenterOptions(
        base_options=base_options,
        output_category_mask=True
    )

    with vision.ImageSegmenter.create_from_options(options) as segmenter:
        result = segmenter.segment(mp_image)

    category_mask = result.category_mask.numpy_view() if getattr(result, "category_mask", None) is not None else None
    alpha_mask = build_hair_alpha_mask(category_mask)

    hair_only = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2BGRA)
    hair_only[:, :, 3] = (alpha_mask * 255).astype(np.uint8)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    success = cv2.imwrite(output_path, hair_only)

    if not success:
        raise RuntimeError(f"Failed to write segmented PNG to {output_path}")

    return output_path


def main() -> None:
    args = parse_args()

    if not os.path.exists(args.input_path):
        fail_and_exit(f"Input file not found: {args.input_path}")

    if not os.path.exists(args.model_path):
        fail_and_exit(f"Model file not found: {args.model_path}")

    log(f"Segmenting image: {args.input_path}")
    log(f"Model path: {args.model_path}")
    log(f"Output path: {args.output_path}")

    try:
        real_output_path = segment_image(args.input_path, args.output_path, args.model_path)

        with open(real_output_path, "rb") as output_file:
            encoded = base64.b64encode(output_file.read()).decode("utf-8")

        emit_json({"image": f"data:image/png;base64,{encoded}"})
        log("Segmentation complete, sent JSON to stdout")
    except Exception as error:
        log("Exception during segmentation:")
        log(traceback.format_exc())
        fail_and_exit(str(error))


if __name__ == "__main__":
    main()
