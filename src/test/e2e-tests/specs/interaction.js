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

describe( 'dechat interactions', function () {
    it ( 'Check that the new Chat button is hidden when you press it', function () {
         element( by.id( 'new-btn' ) ).click().then( function () {
                expect( element( by.id( 'new-btn' ).isDisplayed()).toBe( true );
                expect( element( by.id( 'join-btn' ).isDisplayed()).toBe( true );
                expect( element( by.id( 'open-btn' ).isDisplayed()).toBe( true );
                       
        });
    });
    it ( 'Check that the join Chat button is hidden when you press it ', function () {
         element( by.id( 'join-btn' ) ).click().then( function () {
                expect( element( by.id( 'new-btn' ).isDisplayed()).toBe( true );
                expect( element( by.id( 'join-btn' ).isDisplayed()).toBe( true );
                expect( element( by.id( 'open-btn' ).isDisplayed()).toBe( true );
        });
    });
    it ( 'Check that the continue Chat button is hidden when you press it ', function () {
         element( by.id( 'open-btn' ) ).click().then( function () {
                expect( element( by.id( 'new-btn' ).isDisplayed()).toBe( true );
                expect( element( by.id( 'open-btn' ).isDisplayed()).toBe( true );
                expect( element( by.id( 'join-btn' ).isDisplayed()).toBe( true );
        });
    });
});
 
describe( 'dechat interactions', function () {
    it ( 'Check chat area ', function () {
            element( by.id( 'start-new-chat-btn' ) ).click().then( function () {
            expect( element( by.id( 'chat' ).isPresent()).toBe(true);
            expect( element( by.id( 'start-new-chat-btn' ).isPresent()).toBe(false);
        });
    });
});

