FROM python:3.12-alpine

WORKDIR /app

COPY server.py .
COPY index.html review-index.html check-index.html paper.html paper-check.html login.html datasets-index.html metrics-index.html ./
COPY js/ js/
COPY css/ css/
COPY data.json .

EXPOSE 8765

CMD ["python3", "server.py", "8765"]
