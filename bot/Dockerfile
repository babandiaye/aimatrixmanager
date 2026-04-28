FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libolm-dev \
    libolm3 \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py .

RUN mkdir -p /app/store && chmod 700 /app/store

CMD ["python", "-u", "main.py"]
