#!/usr/bin/env python3
"""
Simple object detection example following PyCoral patterns
Based on the detect_image.py example from google-coral/pycoral
"""

import argparse
import time
from PIL import Image
from PIL import ImageDraw

from pycoral.adapters import common
from pycoral.adapters import detect
from pycoral.utils.dataset import read_label_file
from pycoral.utils.edgetpu import make_interpreter


def draw_objects(draw, objs, labels):
    """Draws the bounding box and label for each object."""
    for obj in objs:
        bbox = obj.bbox
        draw.rectangle([(bbox.xmin, bbox.ymin), (bbox.xmax, bbox.ymax)],
                      outline='red', width=3)
        draw.text((bbox.xmin + 10, bbox.ymin + 10),
                  '%s\n%.2f' % (labels.get(obj.id, obj.id), obj.score),
                  fill='red')


def main():
    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('-m', '--model', 
                        default='/workspace/pycoral/test_data/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite',
                        help='File path of .tflite file compiled for Edge TPU')
    parser.add_argument('-i', '--input',
                        default='/workspace/pycoral/test_data/grace_hopper.bmp',
                        help='File path of image to process')
    parser.add_argument('-l', '--labels',
                        default='/workspace/pycoral/test_data/coco_labels.txt',
                        help='File path of labels file')
    parser.add_argument('-t', '--threshold', type=float, default=0.4,
                        help='Score threshold for detected objects')
    parser.add_argument('-o', '--output',
                        help='File path for the result image with annotations')
    parser.add_argument('-c', '--count', type=int, default=5,
                        help='Number of times to run inference')
    args = parser.parse_args()

    # Initialize the TF interpreter
    print('Loading model:', args.model)
    interpreter = make_interpreter(args.model)
    interpreter.allocate_tensors()
    
    # Load labels
    labels = read_label_file(args.labels) if args.labels else {}

    # Load and resize image
    image = Image.open(args.input)
    _, scale = common.set_resized_input(
        interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))

    print('----INFERENCE TIME----')
    print('Note: The first inference is slow because it includes loading the model into Edge TPU memory.')
    
    # Run inference multiple times to show performance
    for _ in range(args.count):
        start = time.perf_counter()
        interpreter.invoke()
        inference_time = time.perf_counter() - start
        objs = detect.get_objects(interpreter, args.threshold, scale)
        print('%.2fms' % (inference_time * 1000))

    print('-------RESULTS--------')
    if not objs:
        print('No objects detected')
    
    for obj in objs:
        print(labels.get(obj.id, obj.id))
        print('  id:    ', obj.id)
        print('  score: ', obj.score)
        print('  bbox:  ', obj.bbox)

    # Save result image with bounding boxes if output path specified
    if args.output:
        image = image.convert('RGB')
        draw_objects(ImageDraw.Draw(image), objs, labels)
        image.save(args.output)
        print('Saved result image to:', args.output)


if __name__ == '__main__':
    main()