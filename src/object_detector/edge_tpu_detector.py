#!/usr/bin/env python3
"""
Edge TPU Object Detector for DroneOS
Based on PyCoral examples for object detection and classification
Uses Google Coral Edge TPU for real-time inference
"""

import os
import pathlib
import time
import argparse
from PIL import Image
import numpy as np

# Following the PyCoral API structure from instructions
from pycoral.utils import edgetpu
from pycoral.utils import dataset
from pycoral.adapters import common
from pycoral.adapters import classify
from pycoral.adapters import detect


class EdgeTPUDetector:
    """Object detector using Edge TPU accelerator"""
    
    def __init__(self, model_path, labels_path, threshold=0.4):
        """
        Initialize the Edge TPU detector
        
        Args:
            model_path: Path to the Edge TPU model file (.tflite)
            labels_path: Path to the labels file
            threshold: Confidence threshold for detections (0-1)
        """
        self.threshold = threshold
        
        # Load labels
        self.labels = read_label_file(labels_path) if labels_path else {}
        
        # Initialize the TF interpreter for Edge TPU
        print("Initializing Edge TPU...")
        self.interpreter = edgetpu.make_interpreter(model_path)
        self.interpreter.allocate_tensors()
        
        # Get model input size
        self.input_size = common.input_size(self.interpreter)
        print(f"Model input size: {self.input_size}")
        
    def detect_image(self, image_path):
        """
        Run object detection on an image
        
        Args:
            image_path: Path to the input image
            
        Returns:
            List of detected objects with bounding boxes and scores
        """
        # Load and preprocess image
        image = Image.open(image_path).convert('RGB')
        image_resized = image.resize(self.input_size, Image.LANCZOS)
        
        # Run inference
        common.set_input(self.interpreter, image_resized)
        
        # Measure inference time
        start = time.perf_counter()
        self.interpreter.invoke()
        inference_time = time.perf_counter() - start
        
        # Get detection results
        objects = detect.get_objects(self.interpreter, self.threshold)
        
        # Format results
        results = []
        for obj in objects:
            # Scale bounding box to original image size
            bbox = obj.bbox.scale(image.width / self.input_size[0], 
                                  image.height / self.input_size[1])
            
            result = {
                'label': self.labels.get(obj.id, obj.id),
                'score': obj.score,
                'bbox': {
                    'xmin': bbox.xmin,
                    'ymin': bbox.ymin,
                    'xmax': bbox.xmax,
                    'ymax': bbox.ymax
                }
            }
            results.append(result)
            
        return results, inference_time
    
    def detect_from_array(self, image_array):
        """
        Run object detection on a numpy array (e.g., from camera feed)
        
        Args:
            image_array: Numpy array representing the image
            
        Returns:
            List of detected objects with bounding boxes and scores
        """
        # Convert numpy array to PIL Image
        image = Image.fromarray(image_array).convert('RGB')
        original_size = image.size
        
        # Resize to model input size
        image_resized = image.resize(self.input_size, Image.LANCZOS)
        
        # Run inference
        common.set_input(self.interpreter, image_resized)
        
        start = time.perf_counter()
        self.interpreter.invoke()
        inference_time = time.perf_counter() - start
        
        # Get detection results
        objects = detect.get_objects(self.interpreter, self.threshold)
        
        # Format results
        results = []
        for obj in objects:
            # Scale bounding box to original image size
            bbox = obj.bbox.scale(original_size[0] / self.input_size[0], 
                                  original_size[1] / self.input_size[1])
            
            result = {
                'label': self.labels.get(obj.id, obj.id),
                'score': obj.score,
                'bbox': {
                    'xmin': int(bbox.xmin),
                    'ymin': int(bbox.ymin),
                    'xmax': int(bbox.xmax),
                    'ymax': int(bbox.ymax)
                }
            }
            results.append(result)
            
        return results, inference_time


def main():
    """Example usage of the Edge TPU detector"""
    parser = argparse.ArgumentParser(description='Edge TPU Object Detection')
    parser.add_argument('--model', type=str, 
                        default='/workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite',
                        help='Path to Edge TPU model file')
    parser.add_argument('--labels', type=str,
                        default='/workspace/models/coco_labels.txt',
                        help='Path to labels file')
    parser.add_argument('--image', type=str,
                        default='/workspace/pycoral/test_data/grace_hopper.bmp',
                        help='Path to input image')
    parser.add_argument('--threshold', type=float, default=0.4,
                        help='Score threshold for detected objects')
    
    args = parser.parse_args()
    
    # Check if Edge TPU is available
    try:
        import subprocess
        result = subprocess.run(['lsusb'], capture_output=True, text=True)
        if 'Google' in result.stdout:
            print("Edge TPU detected via USB")
        else:
            print("Warning: Edge TPU not detected via USB. Running in CPU mode.")
    except:
        pass
    
    # Initialize detector
    detector = EdgeTPUDetector(args.model, args.labels, args.threshold)
    
    # Run detection
    print(f"\nRunning detection on: {args.image}")
    results, inference_time = detector.detect_image(args.image)
    
    # Print results
    print(f"\n{'='*50}")
    print(f"Inference time: {inference_time*1000:.2f} ms")
    print(f"{'='*50}")
    
    if results:
        print(f"\nDetected {len(results)} objects:")
        for i, obj in enumerate(results):
            print(f"\n{i+1}. {obj['label']}")
            print(f"   Score: {obj['score']:.2%}")
            print(f"   Bounding box: ({obj['bbox']['xmin']}, {obj['bbox']['ymin']}) - " + 
                  f"({obj['bbox']['xmax']}, {obj['bbox']['ymax']})")
    else:
        print("\nNo objects detected")


if __name__ == '__main__':
    main()