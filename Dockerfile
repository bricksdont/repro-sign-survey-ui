FROM python:3.12-alpine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY index.html review-index.html check-index.html paper.html paper-check.html login.html oauth-redirect.html datasets-index.html metrics-index.html dataset.html metric.html stats.html ready-index.html ./
COPY js/ js/
COPY css/ css/
COPY data.json .
COPY package.json .
COPY favicon.png .

EXPOSE 8765

CMD ["python3", "server.py", "8765"]
