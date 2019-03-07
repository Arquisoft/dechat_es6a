'use strict'

describe( 'dechat interactions', function () {});
var path = require( 'C:\Program Files\nodejs\' );

browser.get( '/' );

it ( 'should redirect to /', function () {
    expect( browser.getLocationAbsUrl() ).toMatch( '/' );
});

it ( 'should click login', function () {
    element( by.id( 'new-btn' ) ).click().then( function () {
            expect( element( by.id( 'data-url' ) ).count() ).toBe( 1 );
    });
});
