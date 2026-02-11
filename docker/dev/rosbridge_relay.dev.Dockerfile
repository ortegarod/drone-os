FROM python:3.11-slim

WORKDIR /app

# Install websockets library
RUN pip install --no-cache-dir websockets

# Copy relay script
COPY docker/dev/rosbridge_relay.py /app/rosbridge_relay.py
RUN chmod +x /app/rosbridge_relay.py

CMD ["python3", "/app/rosbridge_relay.py"]
