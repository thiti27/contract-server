FROM node:19.5.0-alpine
 
ARG TIMEZONE="Asia/Bangkok"
RUN apk add tzdata
RUN cp /usr/share/zoneinfo/${TIMEZONE} /etc/localtime
RUN "date"

# Create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
 
# Install app dependencies
COPY package.json /usr/src/app/
RUN npm install
 
# Bundle app source
COPY . /usr/src/app
 
EXPOSE 1312
CMD [ "npm", "start" ]