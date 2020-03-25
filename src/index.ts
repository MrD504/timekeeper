import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

import { WebClient } from '@slack/web-api';
const bot = new WebClient(functions.config().slack.token);

const { PubSub } = require('@google-cloud/pubsub');
const pubsubClient = new PubSub();

admin.initializeApp();
const db = admin.firestore();

export const myBot = functions.https.onRequest(async (req, res) => {

  if (req.body.text === "help") {
    const msg = `Commands:
      join (add yourself to the database)\n
      clock-in (clock in for the day)\n
      clock-out (clock out for the day)\n
      hours-today (see what hours you've worked today)\n
      help`;

    res.send({
      "response_type": "ephemeral",
      "text": msg
    })
  } else {
    try {
      res.send({
        "response_type": "ephemeral",
        "text": "Boop beep boop... processing"
      })
      
      const dataBuffer = Buffer.from(JSON.stringify(req.body), 'utf8');
      await pubsubClient.topic('manage-timesheet').publish(dataBuffer);

    } catch (err) {
      console.error(err);
      res.send({
        "response_type": "ephemeral",
        "text": err.message});
    }
  }

  // when first setting up a function you must verify with slack by returning challenge
  // to prove you own it
  // const {challenge} = req.body;
  // res.send({challenge})

});

export const manageTimesheet = functions.pubsub.topic('manage-timesheet')
  .onPublish(async (message, context) => {
    try {
      const request = JSON.parse(Buffer.from(message.data, 'base64').toString())
      const { text, channel_id, user_id } = request;
      const userResult = await bot.users.profile.get({ user: user_id });
      const { email, display_name } = userResult.profile as any;

      console.info(request)
      console.info(userResult);

      if (text.indexOf("join") !== -1) {
        //check if user exists
        const userInfo = await getUser(email);
        if (userInfo.empty) {
          await createUser(email);
          await handleMessageToUser(channel_id, user_id, `${display_name} has joined timekeeping`);
        } else {
          await handleMessageToUser(channel_id, user_id, `${display_name} already exists in database`)
        }

      }

      if (text.indexOf("clock-in") !== -1) {
        const userInfo = await getUser(email);
        if (userInfo.empty) {
          await handleMessageToUser(channel_id, user_id, `${display_name} does not exist in database please type @timekeeper join and then try to clock in again`);
          return;
        }

        userInfo.docs.forEach(async (item) => {
          const msg = await handleClockingIn(item.id);
          await handleMessageToUser(channel_id, user_id, msg)
        })
      }

      if (text.indexOf("clock-out") !== -1) {
        const userInfo = await getUser(email);
        if (userInfo.empty) {
          await handleMessageToUser(channel_id, user_id, `${display_name} does not exist in database please type @timekeeper join`);
          return;
        }

        userInfo.docs.forEach(async (item) => {
          const msg = await handleClockingOut(item.id);
          await handleMessageToUser(channel_id, user_id, msg)
        })
      }

      if (text.indexOf("hours-today") !== -1) {
        const userInfo = await getUser(email);
        userInfo.docs.forEach(async (item) => {
          const matchingDate = await db.collection('datesWorked').where('userId', '==', item.id).where('date', '==', new Date().toDateString()).get();
          if (matchingDate.empty) {
            await handleMessageToUser(channel_id, user_id, `${display_name} has been a lazy bum today`)
          } else {
            matchingDate.docs.forEach(async (dayWorked) => {
              const data = dayWorked.data();
              await handleMessageToUser(channel_id, user_id, `${display_name} ${data.date}, ${data.start} - ${data.end === '' ? "still working" : data.end}`)
            })
          }
        })

      }
    } catch (err) {
      console.error(err);
      throw new functions.https.HttpsError('unknown', err.message, err);
    }
  })

async function handleClockingIn(userId: string) {

  // get user id
  try {

    // docs are defined
    const responseMessage: any = await handleCreateDate(userId);
    return responseMessage;

  } catch (err) {
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
};

async function handleClockingOut(userId: string) {
  try {
    // find date
    const results = await db.collection('datesWorked').where('userId', '==', userId).where('date', '==', new Date().toDateString()).where('end', '==', '').get();
    let msg = '';
    if (!results.empty) {
      results.docs.forEach(async (result) => {
        await db.collection('datesWorked').doc(result.id).update({
          end: new Date().toLocaleTimeString()
        })
      })
      msg = `clocked out`
    } else {
      msg = 'Already clocked out'
    }

    return msg;

  } catch (err) {
    console.error(err);
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
};

async function getUser(email: string) {
  try {
    return db.collection('user').where('email', '==', email).get();
  } catch(err) {
    console.error(err);
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
};

async function createUser(email: string) {
  try {
    return db.collection('user').add({
      email: email
    })
  } catch (err) {
    console.error(err);    console.error(err);
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
}

async function handleMessageToUser(channel: string, user: string, message: string) {
  try {
    await bot.chat.postEphemeral({ channel: channel, user: user, text: message })
  } catch (err) {
    console.error(err);
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
  return;
};

async function handleCreateDate(userId: string) {
  // get matching date for today if it exists
  try {
    const matchingDate = await db.collection('datesWorked').where('userId', '==', userId).where('date', '==', new Date().toDateString()).get();
  
    // if todays date does not exist in collection add it
    if (matchingDate.empty) {
      const message = await addDateToCollection(userId);
      return message;
    } else {
      return 'Already clocked in'
    }
  } catch(err) {
    console.error(err);
    throw new functions.https.HttpsError('unknown', err.message, err);
    return 'Oops';
  }
};

async function addDateToCollection(userId: string): Promise<any> {
  try {

    const workDate = new Date().toDateString();
    const startTime = new Date().toLocaleTimeString()
    await db.collection('datesWorked').add({
      userId: userId,
      date: workDate,
      end: '',
      start: startTime,
    });
    
    return `Clocked in on ${workDate} at ${startTime}`;
  } catch (err) {
    console.error(err);
    throw new functions.https.HttpsError('unknown', err.message, err);
  }
}