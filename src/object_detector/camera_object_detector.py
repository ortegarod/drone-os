#!/usr/bin/env python3
"""
Camera Object Detector using Edge TPU
Subscribes to ROS 2 camera topics and performs real-time object detection
"""

import os
import sys
import time
import argparse
import numpy as np
from PIL import Image

# ROS 2 imports
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image as ImageMsg
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import Header
from cv_bridge import CvBridge

# PyCoral imports
from pycoral.utils import edgetpu
from pycoral.utils import dataset
from pycoral.adapters import common
from pycoral.adapters import detect
from pycoral.utils.dataset import read_label_file

# Object detection message (create custom message type later)
from geometry_msgs.msg import Point, Vector3
from visualization_msgs.msg import Marker, MarkerArray


class CameraObjectDetector(Node):
    """ROS 2 node for object detection using Edge TPU on camera feed"""
    
    def __init__(self):
        super().__init__('camera_object_detector')
        
        # Declare parameters
        self.declare_parameter('model_path', '/workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite')
        self.declare_parameter('labels_path', '/workspace/models/coco_labels.txt')
        self.declare_parameter('threshold', 0.5)
        self.declare_parameter('camera_topic', '/image_raw')
        self.declare_parameter('publish_rate', 10.0)  # Max detection rate in Hz
        self.declare_parameter('drone_name', 'drone1')
        
        # Get parameters
        self.model_path = self.get_parameter('model_path').value
        self.labels_path = self.get_parameter('labels_path').value
        self.threshold = self.get_parameter('threshold').value
        self.camera_topic = self.get_parameter('camera_topic').value
        self.publish_rate = self.get_parameter('publish_rate').value
        self.drone_name = self.get_parameter('drone_name').value
        
        # Initialize Edge TPU
        self.get_logger().info("Initializing Edge TPU...")
        try:
            self.interpreter = edgetpu.make_interpreter(self.model_path)
            self.interpreter.allocate_tensors()
            self.input_size = common.input_size(self.interpreter)
            self.labels = read_label_file(self.labels_path) if self.labels_path else {}
            self.get_logger().info(f"Edge TPU initialized with model: {self.model_path}")
            self.get_logger().info(f"Input size: {self.input_size}")
        except Exception as e:
            self.get_logger().error(f"Failed to initialize Edge TPU: {e}")
            sys.exit(1)
        
        # Initialize CV Bridge
        self.bridge = CvBridge()
        
        # Create subscribers
        self.image_sub = self.create_subscription(
            ImageMsg,
            self.camera_topic,
            self.image_callback,
            10
        )
        
        # Create publishers
        self.marker_pub = self.create_publisher(
            MarkerArray,
            f'/{self.drone_name}/detected_objects',
            10
        )
        
        # Create annotated image publisher
        self.annotated_image_pub = self.create_publisher(
            ImageMsg,
            f'/{self.drone_name}/annotated_image',
            10
        )
        
        # Rate limiting
        self.last_detection_time = 0
        self.min_detection_interval = 1.0 / self.publish_rate
        
        # Statistics
        self.inference_times = []
        self.frame_count = 0
        
        # Create timer for statistics
        self.create_timer(5.0, self.print_statistics)
        
        self.get_logger().info(f"Camera Object Detector started for {self.drone_name}")
        self.get_logger().info(f"Subscribing to: {self.camera_topic}")
    
    def image_callback(self, msg):
        """Process incoming camera images"""
        current_time = time.time()
        
        # Rate limiting
        if current_time - self.last_detection_time < self.min_detection_interval:
            return
        
        try:
            # Convert ROS image to OpenCV format
            cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding='rgb8')
            
            # Run detection
            detections, inference_time = self.detect_objects(cv_image)
            
            # Update statistics
            self.inference_times.append(inference_time)
            self.frame_count += 1
            self.last_detection_time = current_time
            
            # Publish results
            if detections:
                self.publish_detections(detections, msg.header)
                self.publish_annotated_image(cv_image, detections, msg.header)
            
        except Exception as e:
            self.get_logger().error(f"Error processing image: {e}")
    
    def detect_objects(self, cv_image):
        """Run object detection on OpenCV image"""
        # Convert to PIL Image
        pil_image = Image.fromarray(cv_image)
        
        # Resize to model input size
        resized = pil_image.resize(self.input_size, Image.LANCZOS)
        
        # Set input
        common.set_input(self.interpreter, resized)
        
        # Run inference
        start_time = time.perf_counter()
        self.interpreter.invoke()
        inference_time = (time.perf_counter() - start_time) * 1000  # ms
        
        # Get results
        scale_x = cv_image.shape[1] / self.input_size[0]
        scale_y = cv_image.shape[0] / self.input_size[1]
        
        objects = detect.get_objects(self.interpreter, self.threshold)
        
        # Format detections
        detections = []
        for obj in objects:
            bbox = obj.bbox
            detection = {
                'label': self.labels.get(obj.id, str(obj.id)),
                'score': obj.score,
                'bbox': {
                    'xmin': int(bbox.xmin * scale_x),
                    'ymin': int(bbox.ymin * scale_y),
                    'xmax': int(bbox.xmax * scale_x),
                    'ymax': int(bbox.ymax * scale_y)
                }
            }
            detections.append(detection)
        
        return detections, inference_time
    
    def publish_detections(self, detections, header):
        """Publish detected objects as markers"""
        marker_array = MarkerArray()
        
        for i, det in enumerate(detections):
            marker = Marker()
            marker.header = header
            marker.header.frame_id = f"{self.drone_name}_camera_link"
            marker.ns = "detections"
            marker.id = i
            marker.type = Marker.TEXT_VIEW_FACING
            marker.action = Marker.ADD
            
            # Position at center of bounding box
            bbox = det['bbox']
            marker.pose.position.x = float((bbox['xmin'] + bbox['xmax']) / 2)
            marker.pose.position.y = float((bbox['ymin'] + bbox['ymax']) / 2)
            marker.pose.position.z = 0.0
            
            # Text
            marker.text = f"{det['label']}: {det['score']:.2f}"
            
            # Scale
            marker.scale.z = 20.0  # Text height
            
            # Color (green)
            marker.color.r = 0.0
            marker.color.g = 1.0
            marker.color.b = 0.0
            marker.color.a = 1.0
            
            # Lifetime
            marker.lifetime.sec = 0
            marker.lifetime.nanosec = 500000000  # 0.5 seconds
            
            marker_array.markers.append(marker)
        
        self.marker_pub.publish(marker_array)
    
    def publish_annotated_image(self, cv_image, detections, header):
        """Publish image with bounding boxes drawn"""
        import cv2
        
        # Draw bounding boxes
        annotated = cv_image.copy()
        for det in detections:
            bbox = det['bbox']
            
            # Draw rectangle
            cv2.rectangle(annotated,
                         (bbox['xmin'], bbox['ymin']),
                         (bbox['xmax'], bbox['ymax']),
                         (0, 255, 0), 2)
            
            # Draw label
            label = f"{det['label']}: {det['score']:.2f}"
            cv2.putText(annotated, label,
                       (bbox['xmin'], bbox['ymin'] - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                       (0, 255, 0), 2)
        
        # Convert back to ROS message
        try:
            annotated_msg = self.bridge.cv2_to_imgmsg(annotated, encoding='rgb8')
            annotated_msg.header = header
            self.annotated_image_pub.publish(annotated_msg)
        except Exception as e:
            self.get_logger().error(f"Error publishing annotated image: {e}")
    
    def print_statistics(self):
        """Print detection statistics"""
        if self.inference_times:
            avg_time = np.mean(self.inference_times)
            min_time = np.min(self.inference_times)
            max_time = np.max(self.inference_times)
            
            self.get_logger().info(
                f"Detection stats - Frames: {self.frame_count}, "
                f"Avg: {avg_time:.1f}ms, Min: {min_time:.1f}ms, Max: {max_time:.1f}ms"
            )
            
            # Reset for next interval
            self.inference_times = []


def main(args=None):
    rclpy.init(args=args)
    
    try:
        detector = CameraObjectDetector()
        rclpy.spin(detector)
    except KeyboardInterrupt:
        pass
    finally:
        rclpy.shutdown()


if __name__ == '__main__':
    main()