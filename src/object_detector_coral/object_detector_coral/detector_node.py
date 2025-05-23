import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from vision_msgs.msg import Detection2DArray, Detection2D, ObjectHypothesisWithPose
# from cv_bridge import CvBridge
# import cv2
# from pycoral.adapters import common
# from pycoral.adapters import detect
# from pycoral.utils.edgetpu import make_interpreter

class ObjectDetectorNode(Node):
    def __init__(self):
        super().__init__('object_detector_node')
        self.get_logger().info("Object Detector Node (Coral) starting...")

        # Parameters
        self.declare_parameter('model_path', '/path/to/your/model.tflite')
        self.declare_parameter('threshold', 0.5)
        self.declare_parameter('input_topic', '/camera/image_raw')
        self.declare_parameter('output_topic', '/object_detections')

        model_path = self.get_parameter('model_path').get_parameter_value().string_value
        self.threshold = self.get_parameter('threshold').get_parameter_value().double_value
        input_topic = self.get_parameter('input_topic').get_parameter_value().string_value
        output_topic = self.get_parameter('output_topic').get_parameter_value().string_value

        # self.bridge = CvBridge()
        
        # try:
        #     self.interpreter = make_interpreter(model_path)
        #     self.interpreter.allocate_tensors()
        #     self.get_logger().info(f"Successfully loaded model from {model_path}")
        # except Exception as e:
        #     self.get_logger().error(f"Failed to load model: {e}")
        #     # Consider raising an exception or shutting down
        #     return

        # Subscribers and Publishers
        self.image_subscriber = self.create_subscription(
            Image,
            input_topic,
            self.image_callback,
            10)
        self.detection_publisher = self.create_publisher(
            Detection2DArray,
            output_topic,
            10)
        
        self.get_logger().info(f"Subscribed to {input_topic}")
        self.get_logger().info(f"Publishing detections to {output_topic}")

    def image_callback(self, msg: Image):
        self.get_logger().info(f"Received image: {msg.header.stamp.sec}.{msg.header.stamp.nanosec}")
        # try:
        #     # Convert ROS Image to OpenCV image
        #     cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding='rgb8') # Coral typically wants RGB
        #
        #     # Resize and prepare image for interpreter
        #     _, input_height, input_width, _ = self.interpreter.get_input_details()[0]['shape']
        #     resized_image = cv2.resize(cv_image, (input_width, input_height))
        #
        #     # Run inference
        #     common.set_input(self.interpreter, resized_image)
        #     self.interpreter.invoke()
        #
        #     # Get results
        #     detections = detect.get_objects(self.interpreter, self.threshold)
        #
        #     # Create Detection2DArray message
        #     detection_array_msg = Detection2DArray()
        #     detection_array_msg.header = msg.header # Use the same timestamp and frame_id
        #
        #     for det in detections:
        #         detection_msg = Detection2D()
        #         detection_msg.header = msg.header
        #
        #         # Bounding box
        #         detection_msg.bbox.center.position.x = float(det.bbox.xmin + det.bbox.width / 2)
        #         detection_msg.bbox.center.position.y = float(det.bbox.ymin + det.bbox.height / 2)
        #         detection_msg.bbox.size_x = float(det.bbox.width)
        #         detection_msg.bbox.size_y = float(det.bbox.height)
        #         # detection_msg.bbox.center.theta is 0.0 by default if not 2.5D/3D
        #
        #         # Hypothesis
        #         hypothesis = ObjectHypothesisWithPose()
        #         hypothesis.hypothesis.class_id = str(det.id) # Or map to a label name
        #         hypothesis.hypothesis.score = float(det.score)
        #         detection_msg.results.append(hypothesis)
        #
        #         detection_array_msg.detections.append(detection_msg)
        #
        #     if detections:
        #         self.detection_publisher.publish(detection_array_msg)
        #         self.get_logger().info(f"Published {len(detections)} detections.")
        #
        # except Exception as e:
        #     self.get_logger().error(f"Error processing image: {e}")
        pass # Placeholder

def main(args=None):
    rclpy.init(args=args)
    node = ObjectDetectorNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
