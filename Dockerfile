FROM node:20-bookworm AS frontend
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY main.py /app/
COPY src/ /app/src/
COPY --from=frontend /frontend/../static/dist /app/static/dist

RUN mkdir -p /app/data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
