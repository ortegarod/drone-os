FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir requests

COPY docker/dev/camera_proxy.py /app/camera_proxy.py
RUN chmod +x /app/camera_proxy.py

CMD ["python3", "/app/camera_proxy.py"]
