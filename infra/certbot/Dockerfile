FROM certbot/certbot:v3.2.0

COPY obtain.sh /usr/local/bin/obtain.sh
COPY deploy-hook.sh /usr/local/bin/deploy-hook.sh
COPY renew-loop.sh /usr/local/bin/renew-loop.sh
RUN chmod +x /usr/local/bin/obtain.sh /usr/local/bin/deploy-hook.sh /usr/local/bin/renew-loop.sh

ENTRYPOINT ["/usr/local/bin/renew-loop.sh"]
