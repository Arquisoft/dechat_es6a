"use strict";

const Core = require('../lib/core');
const auth = require('solid-auth-client');
const {
	default: data
} = require('@solid/query-ldflex');
const namespaces = require('../lib/namespaces');
const DataSync = require('../lib/datasync');

let core = new Core(auth.fetch);
let userWebId;
let interlocWebId;
let refreshIntervalId;
let dataSync = new DataSync(auth.fetch);
let userDataUrl;
let chatsToJoin = [];
let semanticChat;

//loader
//const {Loader} = require('semantic-chess');

$('.login-btn').click(() => {
	auth.popupLogin({
		popupUri: 'popup.html'
	});
});

$('#logout-btn').click(() => {
	auth.logout();
});

/**
 * This method updates the UI after a chat option has been selected by the user.
 */
function afterChatOption() {
	$('#chat-options').addClass('hidden');
}

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

		//checkForNotifications();
		// refresh every 5sec
		//refreshIntervalId = setInterval(checkForNotifications, 5000);
	} else {
		//alert("you're not logged in");
		$('#nav-login-btn').removeClass('hidden');
		$('#user-menu').addClass('hidden');
		$('#new-chat-options').addClass('hidden');
		$('#join-chat-options').addClass('hidden');
		$('#continue-chat-options').addClass('hidden');
		userWebId = null;
		clearInterval(refreshIntervalId);
		refreshIntervalId = null;
	}
});


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

async function setUpNewConversation() {
	//Initialize conversation
	setUpForEveryChatOption();

	semanticChat = await core.setUpNewChat(userDataUrl, userWebId, interlocWebId, dataSync);

	setUpChat();
}

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

				$select.append($(`<option value="${chat.chatUrl}">${name} (${chat.opponentsName})</option>`));
			});
		} else {
			$('#no-join').removeClass('hidden');
		}
	} else {
		$('#login-required').modal('show');
	}
});

$('#join-chat-btn').click(async() => {
	if ($('#join-data-url').val() !== userWebId) {
		userDataUrl = $('#join-data-url').val();

		if (await core.writePermission(userDataUrl, dataSync)) {
			$('#join-chat-options').addClass('hidden');
			const chatUrl = $('#chat-urls').val();

			let i = 0;

			while (i < chatsToJoin.length && chatsToJoin[i].chatUrl !== chatUrl) {
				i++;
			}

			const chat = chatsToJoin[i];

			// remove it from the array so it's no longer shown in the UI
			chatsToJoin.splice(i, 1);

			// setUpForEveryChatOption();
			// interlocWebId = chat.interlocutorWebId;
			// semanticChat = await core.joinExistingChat(chatUrl, chat.invitationUrl, interlocWebId, userWebId, userDataUrl, dataSync, chat.fileUrl);

			// webrtc = new WebRTC({
			// userWebId,
			// userInboxUrl: await core.getInboxUrl(userWebId),
			// interlocutorWebId: interlocWebId,
			// interlocutorWebId: await core.getInboxUrl(interlocWebId),
			// fetch: auth.fetch,
			// initiator: false,
			// onNewData: rdfjsSource => {
			// let newMessageFound = false;

			// core.checkForNewMessage(semanticChat, dataSync, userDataUrl, rdfjsSource, (san, url) => {
			// semanticChat.loadMessage(san, {url});
			// //semanticChat.getChat().fen()
			// updateStatus();
			// newMessageFound = true;
			// });

			// if (!newMessageFound) {
			// core.checkForGiveUpOfChat(semanticChat, rdfjsSource, (agentUrl, objectUrl) => {
			// semanticChat.loadGiveUpBy(agentUrl);
			// $('#interlocutor-quit').modal('show');
			// });
			// }
			// },
			// onCompletion: () => {
			// $('#real-time-setup').modal('hide');
			// },
			// onClosed: (closedByUser) => {
			// if (!closedByUser && !$('#interlocutor-quit').is(':visible')) {
			// $('#interlocutor-quit').modal('show');
			// }
			// }
			// });

			// webrtc.start();

			// //$('#real-time-setup .modal-body ul').append('<li>Response sent</li><li>Setting up direct connection</li>');
			// //$('#real-time-setup').modal('show');


			// setUpWindow(semanticChat);
			// setUpAfterEveryChatOptionIsSetUp();
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
 * This method lets a player continue an existing chess chat.
 * @param chatUrl: the url of the chat to continue.
 * @returns {Promise<void>}
 */
async function continueExistingChat(chatUrl) {
	setUpForEveryChatOption();

	//No Existing loader!!!
	//const loader = new Loader(auth.fetch);
	//semanticChat = await loader.loadFromUrl(chatUrl, userWebId, userDataUrl);
	//interlocWebId = semanticChat.getOpponentWebId();

	setUpNewConversation();
}


$('#continue-btn').click(async() => {
	if (userWebId) {
		afterChatOption();

		const $tbody = $('#continue-chat-table tbody');
		$tbody.empty();
		$('#continue-chat-options').removeClass('hidden');

		const chats = await core.getChatsToContinue(userWebId);

		$('#continue-looking').addClass('hidden');

		if (chats.length > 0) {
			$('#continue-loading').addClass('hidden');
			$('#continue-chats').removeClass('hidden');

			chats.forEach(async chat => {
				let name = await core.getObjectFromPredicateForResource(chat.chatUrl, namespaces.schema + 'name');

				/*				if (!name) {
									name  chat.chatUrl;
								} else {
									name = name.value;
								}
				*/

				//NO EXISTING LOADER !!

				//const loader = new Loader(auth.fetch);
				//const friendWebId = await loader.findWebIdOfOpponent(chat.chatUrl, userWebId);
				//const friendName = await core.getFormattedName(friendWebId);

				// <td>${name}</td>
				const $row = $(`
          <tr data-chat-url="${chat.chatUrl}" class='clickable-row'>
           	
            <td>${friendName}</td>
          </tr>`);

				$row.click(function () {
					$('#continue-chat-options').addClass('hidden');
					const selectedChat = $(this).data('chat-url');

					let i = 0;

					while (i < chats.length && chats[i].chatUrl !== selectedChat) {
						i++;
					}

					userDataUrl = chats[i].storeUrl;

					continueExistingChat(selectedChat);
				});

				$tbody.append($row);
			});
		} else {
			$('#no-continue').removeClass('hidden');
		}
	} else {
		$('#login-required').modal('show');
	}
});

$('#continue-chat-btn').click(async() => {
	$('#continue-chat-options').addClass('hidden');
	const chats = await core.getChatsToContinue(userWebId);
	const selectedConvo = $('#continue-chat-urls').val();
	let i = 0;

	while (i < chats.length && chats[i].chatUrl !== selectedConvo) {
		i++;
	}

	userDataUrl = chats[i].storeUrl;

	continueExistingChat(selectedConvo);
});

$('.btn-cancel').click(() => {
	interlocWebId = null;

	$('#chat').addClass('hidden');
	$('#new-chat-options').addClass('hidden');
	$('#join-chat-options').addClass('hidden');
	$('#continue-chat-options').addClass('hidden');
	$('#chat-options').removeClass('hidden');
});

async function setUpChat() {
	//const chat = semanticChat.getChat();

	$('#chat').removeClass('hidden');
	$('#chat-loading').addClass('hidden');

	const intName = await core.getFormattedName(interlocWebId);

	$('#interlocutor-name').text(intName);

}

$('#write-chat').click(async() => {
	var d = new Date();
	var options = {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric'
	};
	const username = $('#user-name').text();
	const message = $("#message").val();

	$("#messagesarea").val($("#messagesarea").val() + "\n" + username + " [" + d.toLocaleDateString("en-US", options) + "]> " + message);
	await core.storeMessage(userDataUrl, username, userWebId, d, message, dataSync);

});


/**
 * This method checks if a new message has been made by the friend.
 * The necessarily data is stored and the UI is updated.
 * @returns {Promise<void>}
 */
async function checkForNotifications() {
	console.log('Checking for new notifications');

	const updates = await core.checkUserInboxForUpdates(await core.getInboxUrl(userWebId));

	updates.forEach(async(fileurl) => {
		let newChatFound = false;
		// check for new conversations
		await core.checkForNewChat(semanticChat, userWebId, fileurl, userDataUrl, dataSync, (san, url) => {
			//TODO : no existing semanticChat
			semanticChat.loadMove(san, {
				url
			});
			//board.position(semanticGame.getChess().fen());
			updateStatus();
			newChatFound = true;
		});

		if (!newChatFound) {
			// check for acceptances of invitations
			const response = await core.getResponseToInvitation(fileurl);
			if (response) {
				this.processResponseInNotification(response, fileurl);
			} else {
				// check for games to join
				const convoToJoin = await core.getJoinRequest(fileurl, userWebId);

				if (convoToJoin) {
					chatsToJoin.push(await core.processChatToJoin(convoToJoin, fileurl));
				}
			}
		}
	});
}

/**
 * This method processes a response to an invitation to join a game.
 * @param response: the object representing the response.
 * @param fileurl: the url of the file containing the notification.
 * @returns {Promise<void>}
 */
async function processResponseInNotification(response, fileurl) {
	const rsvpResponse = await core.getObjectFromPredicateForResource(response.responseUrl, namespaces.schema + 'rsvpResponse');
	let chatUrl = await core.getObjectFromPredicateForResource(response.invitationUrl, namespaces.schema + 'event');

	if (gameUrl) {
		chatUrl = chatUrl.value;

		//real time  
		if (semanticChat && semanticChat.getUrl() === chatUrl && semanticChat.isRealTime()) {
			if (rsvpResponse.value === namespaces.schema + 'RsvpResponseYes') {
				$('#real-time-setup .modal-body ul').append('<li>Invitation accepted</li><li>Setting up direct connection</li>');
				webrtc.start();
			}
		}
		//no real time.
		else {
			let convoName = await core.getObjectFromPredicateForResource(chatUrl, namespaces.schema + 'name');

			//NO LOADER Available
			//const loader = new Loader(auth.fetch);

			const friendWebId = await loader.findWebIdOfOpponent(chatUrl, userWebId);
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
		console.log(`No game url was found for response ${response.value}.`);
	}
}
