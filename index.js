/**
 * Created by horat1us on 11.10.16.
 */
"use strict";
const {Cookie, CookieMap} = require('cookiefile'),
    Curl = require('node-libcurl').Curl;

module.exports = {
    PromiseCurl: class PromiseCurl {
        constructor({
            saveCookies = false,
            headers = [],
            timeout = 5,
            curlOptions:options = {},
            referer = "google.com",
            proxy = false
        } = {}) {
            if (saveCookies) {
                this.initCookies();
            }

            this.options = options;
            this.timeout = timeout;
            this.referer = referer;
            this.headers = Array.isArray(headers) ? headers : [headers];
            this.cookieMap = new CookieMap();
            if (proxy !== false && !(proxy instanceof module.exports.Proxy)) {
                throw new module.exports.PromiseCurlError(6);
            }
            this.proxy = proxy;
        }


        request({
            method,
            headers = [],
            referer = this.referer,
            cookies = this.cookieMap,
            data: postdata = false,
            url,
            followLocation = true,
            timeout = this.timeout
        }) {
            if (typeof(method) !== 'string') {
                throw new module.exports.PromiseCurlError(3);
            }
            method = method.toUpperCase();
            if (!url) {
                throw new module.exports.PromiseCurlError(4);
            }
            /**
             * @var {CookieMap} cookies
             */
            return new Promise((resolve, reject) => {
                const curl = new Curl();
                let httpHeader = this.headers;
                if (Array.isArray(headers)) {
                    httpHeader = httpHeader.concat(headers);
                }
                httpHeader.filter(header => header.substr(0, 6) !== 'Cookie');
                httpHeader.push(cookies.toRequestHeader());

                let currentOptions = {
                    referer, timeout, followLocation, url, httpHeader,
                };
                if (method == 'POST' && postdata !== false) {
                    if (Array.isArray(postdata)) {
                        currentOptions.httppost = postdata;
                    } else if (typeof(postdata) === 'object') {
                        currentOptions.postfields =
                            require('querystring').encode(postdata === false ? {} : postdata);
                    } else if (typeof(postdata) === 'string') {
                        currentOptions.postfields = postdata;
                    } else {
                        throw new module.exports.PromiseCurlError(5);
                    }
                }
                if (this.proxy) {
                    currentOptions.proxy = this.proxy.toString();
                }

                const curlOptions = PromiseCurl.initOptions(currentOptions, this.options);

                curlOptions.forEach((nameValue) => curl.setOpt(...nameValue));

                const responseHeaders = [], headersObject = {};
                curl.perform()
                    .on('header', (header) => {
                        const responseHeader = header.toString();

                        responseHeaders.push(responseHeader);
                        this.cookieMap.header(responseHeader);
                    })
                    .on('end', (statusCode, body) => {
                        responseHeaders
                            .map(header => header.replace(/[\n\r]{1,2}/, ''))
                            .filter(header => header.length > 0)
                            .filter(header => header.split(':').length >= 2)
                            .map((header) => header.match(/([^:]*):(.*)/))
                            .forEach(([,name,value]) => headersObject[name.trim()] = value.trim());

                        resolve({
                            statusCode,
                            body,
                            cookies: this.cookieMap,
                            headers: headersObject,
                        });

                    })
                    .on('error', error => {
                        console.log(error);
                        reject(error);
                        curl.close.bind(curl)();
                    });
            });
        }

        setOpt(name, value) {
            this.options[name] = value;
        }

        get(options) {
            return this.request(Object.assign({method: "GET",}, options));
        }

        post(options) {
            return this.request(Object.assign({method: "POST",}, options));
        }

        initCookies(cookieMap = new CookieMap()) {
            this.cookieMap = cookieMap;
        }

        static initOptions(userOptions = {}, mainOptions = {}) {
            const options = [],
                generateOptions = (opts) => {
                    for (let option in opts) {
                        if (!opts.hasOwnProperty(option)) {
                            continue;
                        }
                        if (!Curl.option.hasOwnProperty(option.toUpperCase())) {
                            throw new module.exports.PromiseCurlError(`Unknown Curl Option: ${option}`);
                        }
                        options.push([option.toUpperCase(), opts[option]]);
                    }
                };
            [mainOptions, userOptions].forEach(generateOptions);
            return options;
        }
    },
    Proxy: class Proxy {
        constructor({
            type = 'http',
            host, port,
            username = false, password = false
        }) {
            if (!host || !port) {
                throw new module.exports.PromiseCurlError(2);
            }

            this.auth = (password === false || username === false) ? false : {password, username};

            this.type = Proxy.initProxyType(type);
            this.shortType = type;
            this.host = host;
            this.port = port;
        }

        toString() {
            const auth = this.auth ? `${this.auth.username}:${this.auth.password}@` : '';
            return `${this.shortType}://${auth}${this.host}:${this.port}`;
        }

        /**
         * @param {String} proxyType
         */
        static initProxyType(proxyType) {
            const proxyTypes = require('./proxytypes.js');

            if (proxyTypes.hasOwnProperty(proxyType)) {
                return proxyTypes[proxyType];
            }

            throw new module.exports.PromiseCurlError(1);
        }


    },
    PromiseCurlError: class PromiseCurlError extends Error {
        constructor(errorCode) {
            if (typeof(errorCode) === 'string') {
                return super(errorCode);
            }
            const errors = require('./errors.js');

            super(errors.hasOwnProperty(errorCode) ? errors[errorCode] : `Unknown error: ${errorCode}`);
        }
    }
};