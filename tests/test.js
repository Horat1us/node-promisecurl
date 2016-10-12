/**
 * Created by horat1us on 11.10.16.
 */
/*global describe, it, before, beforeEach, after, afterEach */

"use strict";
const assert = require('assert'),
    expect = require('chai').expect,
    http = require('http'),
    {PromiseCurl} = require('../index.js');

describe('PromiseCurl Main Tests', () => {
    const
        {Cookie} = require('cookiefile'),
        Url = require('url'),
        PostRequestInit = (request, response, onData) => {
            response.writeHead(200, "Success", {"X-Test-Success": true});
            if (request.method.toUpperCase() !== "POST") {
                return response.end(`Fail: Wrong method: ${request.method}`);
            }
            let fullFields = '';
            request.on('data', chunk => fullFields += chunk.toString());
            request.on('end', () => onData(fullFields));
        },
        routes = {
            '/cookies': (request, response) => {
                const cookieMap = new CookieMap();
                cookieMap.generate(request.headers.cookie, {domain: "localhost"});

                let cookieTest = cookieMap.get('test');
                if (!cookieTest) {
                    cookieMap.set(cookieTest = new Cookie({
                        name: "test",
                        value: 0,
                        domain: "localhost",
                    }));
                }
                /** @var {Cookie} cookieTest */
                cookieTest.value = ~~cookieTest.value + 1;

                const headers = cookieMap.toResponseHeader()
                    .map(head => head.match(/([^\:]*)\:(.*)/))
                    .map(([,name,value]) => [name, value]);

                headers.push(["X-Promise-Test", true]);

                response.writeHead(200, "Success", headers);
                response.end('success');
            },
            '/headers': (request, response) => {
                if (request.headers.hasOwnProperty('x-test-headers')) {
                    response.writeHead(200, "Success", {"X-Test-Success": true});
                } else {
                    response.writeHead(500, "Fail");
                }
                response.end("Success");
            },
            '/postfields': (request, response) => {
                PostRequestInit(request, response, data => {
                    const decodedBody = require('querystring').parse(data);

                    response.end(JSON.stringify(decodedBody));
                });
            },
            '/multipart': (request, response) => {
                if (request.method !== 'POST') {
                    response.end(`Wrong method ${request.method} given, POST expected`);
                }
                const multiparty = require('multiparty');

                const form = new multiparty.Form();

                form.parse(request, (error, fields, files) => {
                    response.writeHead(200, "Success", {"X-Test-Success": true});

                    const multipart = JSON.stringify({fields, files});
                    response.end(multipart);
                });
            },
            '/responseHeaders': (request, response) => {
                if (!request.headers.hasOwnProperty('x-test-response-header')) {
                    response.writeHead(500, "Fail");
                    return response.end("Fail");
                }
                response.writeHead(200, "Success", {"x-test-response-answer": true});
                return response.end("Success");
            },
            '/proxy': (request, response) => {
                response.writeHead(200, "Ignored", {"X-Proxy-Ignored": true});
                return response.end('Ignored');
            }
        };
    let server;
    before(() => {
        server = http.createServer((request, response) => {
            const url = Url.parse(request.url);
            if (routes.hasOwnProperty(url.pathname)) {
                routes[url.pathname](request, response);
            } else {
                response.end("Wrong route");
            }
        });
        server.listen(3000);
    });

    describe('Proxies tests', () => {
        const {Proxy, PromiseCurlError} = require('../index.js');
        it('#types', () => {
            const availableProxyTypes = [
                    'http', 'http10', 'socks4', 'socks4a', 'socks5', 'socks5h',
                ],
                host = '8.8.8.8',
                port = 80;


            availableProxyTypes.forEach(type => new Proxy({type, host, port}));
        });
        it('#errors', () => {
            const wrongProxyType = "socks6",
                host = '8.8.8.8',
                port = 80;

            try {
                new Proxy({type: wrongProxyType, host, port});
            }
            catch (Error) {
                expect(Error).to.be.an.instanceof(PromiseCurlError);
            }
        });
        it('#http-proxy', (done) => {
            const http = require('http'),
                httpProxy = require('http-proxy');
            httpProxy.createProxyServer({target: 'http://localhost:3000'}).listen(8000); // See (†)
            const proxyServer = http.createServer(function (req, res) {
                res.writeHead(200, {'X-Proxy-Connected': 'true'});
                res.end('Proxy success');
            }).listen(9000);


            const localProxy = new Proxy({
                type: 'http',
                host: '127.0.0.1',
                port: 9000,
            });

            const promiseCurl = new PromiseCurl({
                proxy: localProxy
            });

            promiseCurl.get({
                url: "http://gooogle.com",
                timeout: 2,
            })
                .then(response => {
                    expect(response.headers).to.have.property('X-Proxy-Connected').and.equal('true');
                    expect(response.headers).not.to.have.property('X-Proxy-Ignored');
                    expect(response.body).to.equal('Proxy success');
                    proxyServer.close();
                    done();
                })
                .catch(error => done(error));
        });
    });


    describe('Headers Tests', () => {

        it('#cookies', (done) => {
            this.timeout = 500;
            const promiseCurl = new PromiseCurl(),
                checkResponse = (response) => {
                    expect(response).to.have.property('statusCode').and.equal(200);
                    expect(response).to.have.property('body').and.equal('success');
                    expect(response).to.have.property('cookies');

                    const cookies = response.cookies;
                    expect(cookies.size).to.be.at.least(1);
                    const cookieTest = cookies.get('test');
                    expect(cookieTest).to.have.property('value').and.equal((++cookieIterator).toString());
                };
            let cookieIterator = 1;

            promiseCurl.cookieMap.set(new Cookie({
                name: "test",
                value: cookieIterator,
                domain: "localhost",
            }));
            promiseCurl.cookieMap.set(new Cookie({
                name: "cookie2",
                value: "sValue",
                domain: "localhost",
            }));
            promiseCurl.get({
                url: 'http://localhost:3000/cookies',
            }).then(response => {
                checkResponse(response);
                return promiseCurl.get({
                    url: "http://localhost:3000/cookies"
                });
            }).then(response => {
                checkResponse(response);
                done();
            }).catch(error => done(error));
        });
        it('#cross-query headers', (done) => {
            const promiseCurl = new PromiseCurl({
                    headers: ["x-test-headers: true"],
                }),
                checkResponse = (response) => {
                    expect(response.body).to.equal("Success");
                };
            promiseCurl.get({
                url: "http://localhost:3000/headers",
            }).then(response => {
                checkResponse(response);
                return promiseCurl.get({
                    url: "http://localhost:3000/headers"
                });
            }).then(response => {
                checkResponse(response);
                done();
            }).catch(error => done(error));
        });
        it('#response headers', (done) => {
            const promiseCurl = new PromiseCurl({
                headers: ['x-test-response-header: true'],
            });

            promiseCurl.get({url: "http://localhost:3000/responseHeaders"})
                .then(response => {
                    expect(response.headers).to.have.property('x-test-response-answer').and.equal('true');
                    expect(response.body).to.equal("Success");
                    done();
                })
                .catch(error => done(error));
        });
    });
    describe('POST Method', () => {
        it('#postfields', (done) => {
            this.timeout = 5000;
            const promiseCurl = new PromiseCurl(),
                data = {
                    hello: "world",
                    you: "must",
                    work: "fork"
                };
            promiseCurl.post({
                data,
                url: "http://localhost:3000/postfields",
            }).then(response => JSON.parse(response.body))
                .then(response => {
                    for (let property in data) {
                        if (!data.hasOwnProperty(property)) {
                            continue;
                        }
                        expect(response).to.have.property(property).and.equal(data[property]);
                    }
                    done();
                }).catch(error => done(error));
        });
        it('#multipart-form-data', (done) => {
            this.timeout = 5000;
            const promiseCurl = new PromiseCurl(),
                data = [
                    {name: "hello", contents: "world"},
                    {name: "i'll", contents: "be back"}
                ];
            promiseCurl.post({
                data,
                url: "http://localhost:3000/multipart"
            }).then(response => JSON.parse(response.body))
                .then(response => {
                    expect(response).to.have.property('fields');
                    const {fields} = response;
                    data.forEach(({name:field, contents:value})=> {
                        expect(fields).to.have.property(field);
                        expect(fields[field]).to.have.lengthOf(1);
                        expect(fields[field][0]).to.equal(value);
                    });
                    done();
                }).catch(error => done(error))
            ;
        });
    });
    //TODO: Check error catching

    after(() => {
        server.close();
    });
});