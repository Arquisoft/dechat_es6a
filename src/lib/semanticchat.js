class SemanticChat {

	constructor(options) {

		this.url = options.url;
		this.userWebId = options.userWebId;
		this.interlocutorWebId = options.interlocutorWebId;
		this.chatBaseUrl = options.chatBaseUrl;
		this.messages = [];
		this.numberOfMessages = 0;

		// if move base url is a string create function that returns this string
		// else a function so we leave it
		if (typeof this.chatBaseUrl === 'string') {
			const t = this.chatBaseUrl;

			this.chatBaseUrl = function () {
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
	 * @returns {string}: Representation of the chat
	 */
	getMinimumInfo() {
		this.minimumInfo = `<${this.url}>`;
		return this.minimumInfo;

	}

	getUrl() {
		return this.url;
	}

	getInterlocutorWebId() {
		return this.interlocutorWebId;
	}

	loadMessage(message) {
		this.messages[this.numberOfMessages] = message;
		this.numberOfMessages += 1;
	}


	getMessages() {
		return this.messages;
	}


}

module.exports = SemanticChat;
