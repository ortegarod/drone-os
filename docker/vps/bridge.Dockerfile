FROM python:3.13-slim

WORKDIR /app
COPY dispatch/requirements.txt /app/dispatch/requirements.txt
RUN pip install --no-cache-dir -r dispatch/requirements.txt
COPY dispatch/ /app/dispatch/

CMD ["python3", "dispatch/bridge.py"]
