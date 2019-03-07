'use strict'

describe( 'NetChat Interactions', function () {});
var path = require( 'C:\Program Files\nodejs\' );

browser.get( '/' );

it ( 'should redirect to /', function () {
    expect( browser.getLocationAbsUrl() ).toMatch( '/' );
});