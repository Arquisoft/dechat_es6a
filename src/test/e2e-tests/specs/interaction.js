'use strict'

browser.get( '/' );

describe( 'dechat interactions', function () {
    it ( 'should redirect to /', function () {
        expect( browser.getLocationAbsUrl() ).toMatch( '/' );
    });
});

describe( 'dechat interactions', function () {
    it ( 'should click login', function () {
        element( by.id( 'new-btn' ) ).click().then( function () {
                expect( element( by.id( 'data-url' ) ).count() ).toBe( 1 );
        });
    });
});

describe( 'dechat interactions', function () {
    it ( 'Check login button text ', function () {
            var btnLogin = element(by.id('nav-login-btn'));
            expect(btnLogin.getText()).toEqual('Log in');
        });
    });
});

