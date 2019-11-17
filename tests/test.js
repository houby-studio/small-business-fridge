// Import the dependencies for testing
var chai = require('chai');
var chaiHttp = require('chai-http');
var app = require('../app');
chai.use(chaiHttp);
chai.should();
describe("Small Business Fridge", () => {
    describe("GET /", () => {
        // Test to load index page
        it("should get index page", (done) => {
            chai.request(app)
                .get('/')
                .end((err, res) => {
                    res.should.have.status(200);
                    res.body.should.be.a('object');
                    done();
                });
        });

        // Test API to load user display name
        it("should get user display name", (done) => {
            chai.request(app)
                .get('/api/customerName?customer=1')
                .set('sbf-API-secret','veryveryverysecretapikey')
                .end((err, res) => {
                    res.should.have.status(200);
                    res.should.be.json;
                    res.body.should.eql("James Jameson");
                    done();
                });
        });

        // Test API to load user display name without API key
        it("should get 400 bad request", (done) => {
            chai.request(app)
                .get('/api/customerName?customer=1')
                .set('Accept', 'application/problem+json')
                .end((err, res) => {
                    res.should.have.status(400);
                    res.should.have.header('content-type', 'application/problem+json');
                    done();
                });
        });
    });
});