# Use official Python image
FROM python:3.10-slim

WORKDIR /app

# Install poppler for pdf2image
RUN apt-get update && apt-get install -y poppler-utils

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Start FastAPI with Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"] 