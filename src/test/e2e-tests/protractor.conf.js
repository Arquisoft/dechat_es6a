exports.config  = {
    allScriptsTimeout   : 11000,
        baseUrl             : 'http://192.168.1.42:8080',
	capabilities        : {
    	browserName     : 'firefox'
    },
    framework           : 'jasmine2',
        jasmineNodeOpts     : {
    	defaultTimeoutInterval  : 100000
    },
    seleniumAddress     : 'http://localhost:4444/wd/hub',
    specs               : [
        'e2e-tests/specs/interaction.js'
    ]
};
