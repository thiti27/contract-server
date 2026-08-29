FROM node:19.5.0-bookworm

ARG TIMEZONE="Asia/Bangkok"

# Debian (bookworm) base instead of the previous Alpine image — needed for LibreOffice
# Headless (Contract Requisition Form PDF generation, see services/pdf/libreOfficeService.js),
# which has no reliable Alpine package. Node.js version is intentionally left unchanged
# (19.5.0) to avoid disturbing any existing dependency behavior.
#
# fonts-thai-tlwg provides Thai-script glyph coverage (LibreOffice has none by default
# on a fresh Debian install) — the template's actual font, Tahoma, is a Microsoft font
# not available here, so /etc/fonts/local.conf below tells fontconfig to substitute a
# Thai-capable font (Waree) whenever "Tahoma" is requested, so both Thai and Latin text
# in the generated PDF render as real glyphs instead of tofu boxes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tzdata \
       fontconfig \
       fonts-thai-tlwg \
       libreoffice \
    && ln -snf /usr/share/zoneinfo/${TIMEZONE} /etc/localtime \
    && echo ${TIMEZONE} > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

COPY docker/fontconfig-tahoma-thai.conf /etc/fonts/local.conf

# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json /usr/src/app/
COPY package-lock.json /usr/src/app/
RUN npm install

# Bundle app source
COPY . /usr/src/app

EXPOSE 1312
CMD [ "npm", "start" ]
