FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src src
COPY agent agent
COPY alembic alembic
COPY alembic.ini .

# DB/logs live on a volume, not in the image (see MEDIA_ADMIN_DATA_DIR in src/config.py)
ENV MEDIA_ADMIN_DATA_DIR=/data
VOLUME /data
EXPOSE 8095

# --proxy-headers: nginx in front terminates TLS; the Secure cookie flag keys off X-Forwarded-Proto
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8095", "--proxy-headers", "--forwarded-allow-ips=*"]
