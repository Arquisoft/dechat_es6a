"use strict";

const Core = require('../lib/core');
const auth = require('solid-auth-client');
const {
	default: data
} = require('@solid/query-ldflex');
const namespaces = require('../lib/namespaces');
const DataSync = require('../lib/datasync');
const Loader = require('../lib/loader');


let core = new Core(auth.fetch);
let userWebId;
let interlocWebId;
let refreshIntervalId;
let dataSync = new DataSync(auth.fetch);
let userDataUrl;
let chatsToJoin = [];
let interlocutorMessages = [];
let semanticChat;
let openChat = false;

/**
 *	This method is in charge of showing the popup to login or register
 */
$('.login-btn').click(() => {
	auth.popupLogin({
		popupUri: 'https://solid.github.io/solid-auth-client/dist/popup.html'
	});
});

/**
 *	This method is in charge of the user's logout
 */
$('#logout-btn').click(() => {
	auth.logout();
});

/**
 * This method updates the UI after a chat option has been selected by the user.
 */
function afterChatOption() {
	$('#chat-options').addClass('hidden');
}

/**
 *	This method is in charge of the user's login
 */
auth.trackSession(async session => {
	const loggedIn = !!session;
	//alert(`logged in: ${loggedIn}`);

	if (loggedIn) {
		$('#user-menu').removeClass('hidden');
		$('#nav-login-btn').addClass('hidden');
		$('#login-required').modal('hide');

		userWebId = session.webId;
		const name = await core.getFormattedName(userWebId);

		if (name) {
			$('#user-name').removeClass('hidden');
			$('#user-name').text(name);
		}

		checkForNotifications();
		// refresh every 5sec
		refreshIntervalId = setInterval(checkForNotifications, 5000);
	} else {
		//alert("you're not logged in");
		$('#nav-login-btn').removeClass('hidden');
		$('#user-menu').addClass('hidden');
		$('#new-chat-options').addClass('hidden');
		$('#join-chat-options').addClass('hidden');
		$('#open-chat-options').addClass('hidden');
		userWebId = null;
		clearInterval(refreshIntervalId);
		refreshIntervalId = null;
	}
});


/**
 *	This button is in charge of showing the create chat option
 */
$('#new-btn').click(async() => {
	if (userWebId) {
		afterChatOption();
		$('#new-chat-options').removeClass('hidden');
		$('#data-url').prop('value', core.getDefaultDataUrl(userWebId));

		const $select = $('#contacts');

		for await (const friend of data[userWebId].friends) {
			let name = await core.getFormattedName(friend.value);

			$select.append(`<option value="${friend}">${name}</option>`);
		}
	} else {
		//alert("NOT logged in");
		$('#login-required').modal('show');
	}
});

/**
 *	This method is in charge of starting a new chat with the friend selected from the option menu
 */
$('#start-new-chat-btn').click(async() => {
	const dataUrl = $('#data-url').val();

	if (await core.writePermission(dataUrl, dataSync)) {
		$('#new-chat-options').addClass('hidden');
		interlocWebId = $('#contacts').val();
		userDataUrl = dataUrl;
		setUpNewConversation();
	} else {
		$('#write-permission-url').text(dataUrl);
		$('#write-permission').modal('show');
	}
});

/**
 *	This method is in charge of setting up a new Conversation
 */
async function setUpNewConversation() {
	//Initialize conversation
	setUpForEveryChatOption();

	semanticChat = await core.setUpNewChat(userDataUrl, userWebId, interlocWebId, dataSync);

	setUpChat();
}

/**
 *	This method is in charge of showing the user's invitations from friends to join a chat
 */
$('#join-btn').click(async() => {
	if (userWebId) {
		afterChatOption();
		$('#join-chat-options').removeClass('hidden');
		$('#join-data-url').prop('value', core.getDefaultDataUrl(userWebId));
		$('#join-looking').addClass('hidden');

		if (chatsToJoin.length > 0) {
			$('#join-loading').addClass('hidden');
			$('#join-form').removeClass('hidden');
			const $select = $('#chat-urls');
			$select.empty();

			chatsToJoin.forEach(chat => {
				let name = chat.name;

				if (!name) {
					name = chat.chatUrl;
				}

				$select.append($(`<option value="${chat.chatUrl}">${name} ${chat.interlocutorName}</option>`));
			});
		} else {
			$('#no-join').removeClass('hidden');
		}
	} else {
		$('#login-required').modal('show');
	}
});

/**
 *	This method is in charge of initiating the conversation between the user and the friend concerned
 */
$('#join-chat-btn').click(async() => {
	if ($('#join-data-url').val() !== userWebId) {
		userDataUrl = $('#join-data-url').val();

		if (await core.writePermission(userDataUrl, dataSync)) {
			$('#join-chat-options').addClass('hidden');
			setUpForEveryChatOption();
			const chatUrl = $('#chat-urls').val();

			let i = 0;

			while (i < chatsToJoin.length && chatsToJoin[i].chatUrl !== chatUrl) {
				i++;
			}

			const chat = chatsToJoin[i];
			// remove it from the array so it's no longer shown in the UI
			chatsToJoin.splice(i, 1);


			interlocWebId = chat.friendWebId.id;
			await core.joinExistingChat(chat.invitationUrl, interlocWebId, userWebId, userDataUrl, dataSync, chat.fileUrl);
			setUpChat();
		} else {
			$('#write-permission-url').text(userDataUrl);
			$('#write-permission').modal('show');
		}
	} else {
		console.warn('We are pretty sure you do not want to remove your WebID.');
	}
});


/**
 * This method does the necessary updates of the UI when the different chat options are shown.
 */
function setUpForEveryChatOption() {
	$('#chat-loading').removeClass('hidden');
}

/**
 *	This method is in charge of showing the open chat options
 */
$('#open-btn').click(async() => {
	if (userWebId) {
		afterChatOption();

		const $tbody = $('#open-chat-table tbody');
		$tbody.empty();

		$('#open-chat-options').removeClass('hidden');
		const chats = await core.getChatsToOpen(userWebId);

		$('#open-looking').addClass('hidden');

		if (chats.length > 0) {
			$('#open-loading').addClass('hidden');
			$('#open-chats').removeClass('hidden');

			chats.forEach(async chat => {

				const friendName = await core.getFormattedName(chat.interlocutor);

				const $row = $(`
						  <tr data-chat-url="${chat.chatUrl}" class='clickable-row'>
							<td>Chat de ${friendName}</td>
						  </tr>`);

				$row.click(function () {
					$('#open-chat-options').addClass('hidden');
					const selectedChat = $(this).data('chat-url');

					let i = 0;

					while (i < chats.length && chats[i].chatUrl !== selectedChat) {
						i++;
					}

					userDataUrl = chats[i].storeUrl;

					interlocWebId = chat.interlocutor;

					openExistingChat(selectedChat.split("#")[0]);
				});
				$tbody.append($row);
			});
		} else {
			$('#no-open').removeClass('hidden');
		}
	} else {
		$('#login-required').modal('show');
	}
});

/**
 * This method lets a player open an existing chess chat.
 * @param chatUrl: the url of the chat to open.
 * @returns {Promise<void>}
 */
async function openExistingChat(chatUrl) {
	setUpForEveryChatOption();

	const loader = new Loader(auth.fetch);
	semanticChat = await loader.loadFromUrl(chatUrl, userWebId, userDataUrl);

	//console.log(chatUrl);

	setUpChat();
}

/**
 *	This method is in charge of getting back to the main menu and showing the start, join and open chat buttons
 */
$('.btn-cancel').click(() => {
	interlocWebId = null;
	openChat = false;

	$('#chat').addClass('hidden');
	$('#new-chat-options').addClass('hidden');
	$('#join-chat-options').addClass('hidden');
	$('#open-chat-options').addClass('hidden');
	$('#chat-options').removeClass('hidden');

	$("#messagesarea").val("");
});

/**
 *	This method is in charge of setting up a chat and hiding the buttons start, join and chat.
 */
async function setUpChat() {
	if (semanticChat) {
		//console.log(semanticChat.getMessages());
		semanticChat.getMessages().forEach(async(message) => {
			$("#messagesarea").val($("#messagesarea").val() + "\n" + message.author + " [" + message.time + "]> " + message.messagetext);
		});
	}

	$('#chat').removeClass('hidden');
	$('#chat-loading').addClass('hidden');
	$('#open-chats').addClass('hidden');
	$('#open-chats-options').addClass('hidden');

	const intName = await core.getFormattedName(interlocWebId);

	$('#interlocutor-name').text(intName);

	//const message = $("#message").val();
	var i = 0;
	//console.log("interloc WEBID is :" + interlocWebId); //Decker.solid.community/....

	while (i < interlocutorMessages.length) {
		//console.log("interloc author is: " + interlocutorMessages[i].author); //...../Deker //Yarrick is better
		var nameThroughUrl = interlocutorMessages[i].author.split("/").pop();
		console.log("nombre de authorUrl is:" + nameThroughUrl);
		console.log("original interlocutorName is:" + intName);
		if (nameThroughUrl === intName) {
			$("#messagesarea").val($("#messagesarea").val() + "\n" + intName + " ["+interlocutorMessages[i].time+"]> " + interlocutorMessages[i].messageTx);
			await core.storeMessage(userDataUrl, interlocutorMessages[i].author, userWebId, interlocutorMessages[i].time, interlocutorMessages[i].messageTx, interlocWebId, dataSync, false);
			dataSync.deleteFileForUser(interlocutorMessages[i].inboxUrl);
			interlocutorMessages[i] = "D";
			console.log("Matching names. All Correct");
		}
		i++;
	}
	i = interlocutorMessages.length;
	while (i--) {
		if (interlocutorMessages[i] == "D") {
			interlocutorMessages.splice(i, 1);
		}
	}

	openChat = true;

}

/**
 *	This method is in charge of sending the message and showing it in the text Area
 */
$('#write-chat').click(async() => {
	const username = $('#user-name').text();
	const message = $("#message").val();
	var dateFormat = require('date-fns');
	var now = new Date();
	const time = "21" + dateFormat.format(now, "yy-MM-dd") + "T" + dateFormat.format(now, "hh-mm-ss");

	$("#messagesarea").val($("#messagesarea").val() + "\n" + username + " [" + time + "]> " + message);
	await core.storeMessage(userDataUrl, username, userWebId, time, message, interlocWebId, dataSync, true);

	document.getElementById("message").value = ''; 

});


/**
 * This method checks if a new message has been made by the friend.
 * The necessarily data is stored and the UI is updated.
 * @returns {Promise<void>}
 */
async function checkForNotifications() {
	//console.log('Checking for new notifications');

	const updates = await core.checkUserInboxForUpdates(await core.getInboxUrl(userWebId)); //HECHO

	updates.forEach(async(fileurl) => {

		//console.log(fileurl);

		// check for new
		let newMessageFound = false;
		console.log("Buscando nuevos mensajes");
		let message = await core.getNewMessage(fileurl, userWebId, dataSync);
		console.log(message);
		if (message) {
			console.log("Guardando mensajes");

			newMessageFound = true;
			if (openChat) {
				$("#messagesarea").val($("#messagesarea").val() + "\n" + message.author + " ["+ message.time +"]> " + message.messageTx);
				await core.storeMessage(userDataUrl, message.author, userWebId, message.time, message.messageTx, interlocWebId, dataSync, false);
			} else {
				//If open there is no need to store them
				interlocutorMessages.push(message);
			}
		}

		if (!newMessageFound) {
			console.log("Buscando respuesta a invitación");
			const response = await core.getResponseToInvitation(fileurl);
			if (response) {
				console.log("Procesando respuesta");
				this.processResponseInNotification(response, fileurl);
			} else {
				console.log("Buscar invitacion");
				const convoToJoin = await core.getJoinRequest(fileurl, userWebId);
				//console.log(convoToJoin);
				if (convoToJoin) {
					console.log("Procesando nuevo chat");
					console.log(convoToJoin);
					chatsToJoin.push(await core.processChatToJoin(convoToJoin, fileurl));
				}
			}
		}
	});
	//console.log(interlocutorMessages);
	//console.log(chatsToJoin);
}

/**
 * This method processes a response to an invitation to join a chat.
 * @param response: the object representing the response.
 * @param fileurl: the url of the file containing the notification.
 * @returns {Promise<void>}
 */
async function processResponseInNotification(response, fileurl) {
	const rsvpResponse = await core.getObjectFromPredicateForResource(response.responseUrl, namespaces.schema + 'rsvpResponse');

	let chatUrl = await core.getObjectFromPredicateForResource(response.invitationUrl, namespaces.schema + 'event');

	if (chatUrl) {
		chatUrl = chatUrl.value;

		if (semanticChat && semanticChat.getUrl() === chatUrl) {
			if (rsvpResponse.value === namespaces.schema + 'RsvpResponseYes') {
				//$('#real-time-setup .modal-body ul').append('<li>Invitation accepted</li><li>Setting up direct connection</li>');
				//webrtc.start();
			}
		} else {
			let convoName = await core.getObjectFromPredicateForResource(chatUrl, namespaces.schema + 'name');

			const loader = new Loader(auth.fetch);

			const friendWebId = await loader.findWebIdOfInterlocutor(chatUrl, userWebId);
			const friendsName = await core.getFormattedName(friendWebId);

			//show response in UI
			if (!convoName) {
				convoName = chatUrl;
			} else {
				convoName = convoName.value;
			}

			let text;

			if (rsvpResponse.value === namespaces.schema + 'RsvpResponseYes') {
				text = `${friendsName} accepted your invitation to join "${convoName}"!`;
			} else if (rsvpResponse.value === namespaces.schema + 'RsvpResponseNo') {
				text = `${friendsName} refused your invitation to join ${convoName}...`;
			}

			if (!$('#invitation-response').is(':visible')) {
				$('#invitation-response .modal-body').empty();
			}

			if ($('#invitation-response .modal-body').text() !== '') {
				$('#invitation-response .modal-body').append('<br>');
			}

			$('#invitation-response .modal-body').append(text);
			$('#invitation-response').modal('show');

			dataSync.executeSPARQLUpdateForUser(await core.getStorageForChat(userWebId, chatUrl), `INSERT DATA {
    <${response.invitationUrl}> <${namespaces.schema}result> <${response.responseUrl}>}
  `);
		}

		dataSync.deleteFileForUser(fileurl);
	} else {
		console.log(`No chat url was found for response ${response.value}.`);
	}
}

/**
 *	This method is in charge of deleting the user's inbox. WARNING. a little risky
 */
$('#clear-inbox-btn').click(async() => {
	const resources = await core.getAllResourcesInInbox(await core.getInboxUrl(userWebId));

	resources.forEach(async r => {
		if (await core.fileContainsChatInfo(r)) {
			dataSync.deleteFileForUser(r);
		}
	});
});
