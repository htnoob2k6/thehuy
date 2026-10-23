FROM nginx:1.27-alpine
RUN apk add --no-cache openssl \
    && addgroup -S web \
    && adduser -S -D -H -G web web \
    && mkdir -p /var/cache/nginx /var/run /etc/nginx/certs \
    && chown -R web:web /var/cache/nginx /var/run /etc/nginx \
    && openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/nginx/certs/server.key \
      -out /etc/nginx/certs/server.crt \
      -subj "/CN=localhost" \
    && chown web:web /etc/nginx/certs/server.key /etc/nginx/certs/server.crt \
    && chmod 600 /etc/nginx/certs/server.key
COPY default.conf /etc/nginx/conf.d/default.conf
USER web
EXPOSE 8080 8443
