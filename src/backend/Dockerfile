# Backend DeepSight ROV. Base image dipilih lewat BACKEND_BASE_IMAGE di .env:
#   ultralytics/ultralytics:latest-cpu              laptop tanpa GPU NVIDIA
#   ultralytics/ultralytics:latest                  laptop dengan GPU NVIDIA (CUDA)
#   ultralytics/ultralytics:latest-jetson-jetpack6  Jetson Orin, JetPack 6
#   ultralytics/ultralytics:latest-jetson-jetpack5  Jetson Orin, JetPack 5
ARG BASE_IMAGE=ultralytics/ultralytics:latest-cpu
FROM ${BASE_IMAGE}

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt

# models/best.pt tidak ada di Git: salin dulu ke src/backend/models/ sebelum build
COPY . .

EXPOSE 8000
CMD ["python3", "main.py"]
