exports.config  = {
    allScriptsTimeout   : 11000,
        baseUrl             : 'http://localhost:9001/',
	capabilities        : {
    	browserName     : 'chrome'
    },
    framework           : 'jasmine2',
        jasmineNodeOpts     : {
    	defaultTimeoutInterval  : 100000
    },
    seleniumAddress     : 'http://localhost:4444/wd/hub',
    specs               : [
        'e2e-tests/specs/*.js'
    ]
};