FROM nginx:1.27-alpine

RUN apk add --no-cache inotify-tools wget

COPY nginx.conf /etc/nginx/nginx.conf
COPY templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.d/watch-certs.sh /docker-entrypoint.d/99-watch-certs.sh
RUN chmod +x /docker-entrypoint.d/99-watch-certs.sh

EXPOSE 80 443
