FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY hub_server.py .

EXPOSE 7860

CMD ["uvicorn", "hub_server:app", "--host", "0.0.0.0", "--port", "7860"]
