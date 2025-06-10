#!/usr/bin/env python3
"""
Test Edge TPU following the exact instructions provided
This script mirrors the example from the Edge TPU setup guide
"""

import os
import sys
import argparse
import pathlib
from pycoral.utils import edgetpu
from pycoral.utils import dataset
from pycoral.adapters import common
from pycoral.adapters import classify
from PIL import Image

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Test Edge TPU with image classification')
    parser.add_argument('--model', type=str,
                        default='/workspace/pycoral/test_data/mobilenet_v2_1.0_224_inat_bird_quant_edgetpu.tflite',
                        help='Path to .tflite model compiled for Edge TPU')
    parser.add_argument('--labels', type=str,
                        default='/workspace/pycoral/test_data/inat_bird_labels.txt',
                        help='Path to labels file')
    parser.add_argument('--input', type=str,
                        default='/workspace/pycoral/test_data/parrot.jpg',
                        help='Path to input image')
    args = parser.parse_args()
    
    # Check if files exist
    if not os.path.exists(args.model):
        print(f"Error: Model file not found: {args.model}")
        print("Run 'bash /workspace/pycoral/examples/install_requirements.sh classify_image.py' first")
        sys.exit(1)
    
    # Initialize the TF interpreter
    print("Initializing Edge TPU...")
    interpreter = edgetpu.make_interpreter(args.model)
    interpreter.allocate_tensors()
    
    # Resize the image
    size = common.input_size(interpreter)
    image = Image.open(args.input).convert('RGB').resize(size, Image.ANTIALIAS)
    
    # Run an inference
    common.set_input(interpreter, image)
    
    print("----INFERENCE TIME----")
    print("Note: The first inference on Edge TPU is slow because it includes loading the model into Edge TPU memory.")
    
    # Run inference 5 times to show performance
    import time
    for i in range(5):
        start = time.perf_counter()
        interpreter.invoke()
        end = time.perf_counter()
        print(f"{(end - start) * 1000:.1f}ms")
    
    # Get classification results
    classes = classify.get_classes(interpreter, top_k=1)
    
    # Print the result
    print("-------RESULTS--------")
    labels = dataset.read_label_file(args.labels)
    for c in classes:
        print('%s: %.5f' % (labels.get(c.id, c.id), c.score))

if __name__ == '__main__':
    main()