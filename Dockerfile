FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /doccollab_server .

FROM debian:bullseye-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN sed -i 's/main/main contrib non-free/g' /etc/apt/sources.list \
    && apt-get update \
    && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
    && apt-get install -y --no-install-recommends \
       wkhtmltopdf \
       fonts-dejavu \
       fonts-droid-fallback \
       fonts-freefont-ttf \
       fonts-liberation \
       fontconfig \
       ttf-mscorefonts-installer \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /doccollab_server /usr/local/bin/doccollab_server

WORKDIR /app
COPY static ./static

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/doccollab_server"]