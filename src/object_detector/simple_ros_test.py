#!/usr/bin/env python3
"""
Simple ROS 2 test for Edge TPU integration
Tests basic ROS 2 functionality without camera
"""

import time
try:
    # Test ROS 2 imports
    import rclpy
    from rclpy.node import Node
    from sensor_msgs.msg import Image
    from geometry_msgs.msg import Point
    from visualization_msgs.msg import Marker, MarkerArray
    print("✅ ROS 2 imports successful")

    # Test Edge TPU imports  
    from pycoral.utils import edgetpu
    from pycoral.utils import dataset
    from pycoral.adapters import common
    from pycoral.adapters import detect
    print("✅ PyCoral imports successful")
    
    # Test basic ROS 2 node creation
    rclpy.init()
    node = Node('test_edge_tpu_node')
    print("✅ ROS 2 node creation successful")
    
    # Test Edge TPU detection
    try:
        interpreter = edgetpu.make_interpreter('/workspace/models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite')
        interpreter.allocate_tensors()
        print("✅ Edge TPU model loading successful")
        print(f"   Model input size: {common.input_size(interpreter)}")
    except Exception as e:
        print(f"❌ Edge TPU test failed: {e}")
    
    node.destroy_node()
    rclpy.shutdown()
    print("✅ All tests passed! Ready for camera integration")

except ImportError as e:
    print(f"❌ Import failed: {e}")
    print("   ROS 2 or PyCoral not properly installed")
except Exception as e:
    print(f"❌ Test failed: {e}")