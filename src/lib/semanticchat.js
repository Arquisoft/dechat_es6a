

class SemanticChat {
	
	constructor(options) {

    this.url = options.url;
    this.userWebId = options.userWebId;
    this.interlocutorWebId = options.interlocutorWebId;
    this.messageBaseUrl = options.messageBaseUrl;

    // if move base url is a string create function that returns this string
    // else a function so we leave it
    if (typeof this.messageBaseUrl === 'string') {
      const t = this.messageBaseUrl;

      this.messageBaseUrl = function() {
        return t;
      }
    }

    // set the default uniqid function to the function of the package 'uniqid'
    if (!options.uniqid) {
      this.uniqid = require('uniqid');
    } else {
      this.uniqid = options.uniqid;
    }

  }
  
  /**
   * This method must return a representation of the chat at its initial stage.
   * @returns {string}: Representation of the game
   */
  getMinimumInfo() {
	  
	 this.minimumInfo = `<${this.url}>`;
	 return this.minimumInfo;
	  
  }
  
  getUrl() {
    return this.url;
  }
	
	
	
}

module.exports = SemanticChat;