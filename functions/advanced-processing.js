const libphonenumber = require("libphonenumber-js/max");

/**
 * public twilio function exposed on the /telerivet path.
 * used as webhook from Telerivet when the Libyan Android phone recieves an incoming call. 
 * Decides what happens based off callers item in sync.
 * @param {*} context
 * @param {*} event
 * @param {*} callback
 * @author Charlie Weems https://gist.github.com/cweems
 */

exports.handler = async function (context, event, callback) {
  try {
    let client = context.getTwilioClient();

    let fromNumber = event["to_number"]; //telervit, (number user called)
    let toNumber = event["from_number"]; //telerivet (number that called into telerivt)
    let secret = event["secret"];

    //validate it is a telerivet good request
    if (!secret || secret.toUpperCase() !== context.TELERIVET_SECRET) {
      let response = new Twilio.Response();
      response.setStatusCode(401);
      callback(null, response);
      return;
    }

    //parse from number to get E164 number
    const fromNumRes = libphonenumber.parsePhoneNumber(fromNumber, context.COUNTRY_CODE);
    if (!fromNumRes.isValid()) {
      //invalid number
      throw new Error(`invalid fromNumber: ${fromNumber}`);
    }
    const fromNumberWithCountry = fromNumRes.number;

    //parse to number to get E164 number and check if mobile
    const numRes = libphonenumber.parsePhoneNumber(toNumber, context.COUNTRY_CODE);
    if (!numRes.isValid()) {
      //invalid number
      throw new Error(`invalid toNumber: ${toNumber}`);
    }
    const toNumberWithCountry = numRes.number;
    const isMobile = numRes.getType() === "MOBILE";
    const service = client.sync.services(context.SYNC_SERVICE_SID);
    const doc = await createOrUpdateCaller(service, toNumberWithCountry, fromNumberWithCountry);

    if (doc.data.goneThroughIVR) {
      //check if they have sent an sms if not transfer to send sms
      if (isMobile && !doc.data.hasSentSMS && doc.data.mapId) {
        //send an sms
        await sendSMS(client, service, doc, toNumberWithCountry, context.SMS_FROM);
      }
    } else {
      if ((doc.data.attempts || 1) > 2) {
        //have already tried too many times. log manually.
        const path = Runtime.getFunctions()["ivrcomplete"].path;
        const fn = require(path);
        fn.handler(context, { toNumberWithCountry }, (err, res) => {
          if (err) {
            console.log("ERROR creating map with Unknown's");
            callback(err);
          } else {
            console.log("Unknwown create map item success");
            let response = new Twilio.Response();
            response.setStatusCode(200);
            callback(null, response);
          }
        });
      } else {
        //send to ivr flow
        const execution = await client.studio
          .flows(context.IVR_FLOW_SID)
          .executions
          .create({
            to: toNumberWithCountry,
            from: fromNumberWithCountry,
            parameters: {
              ivrAttempts: doc.data.attempts || 1
            }
          });
      }

      //console.log("OK");
      //console.log(execution.sid);
    }

    //let telerivet know whats good.
    let response = new Twilio.Response();
    response.setStatusCode(200);
    callback(null, response);
  }
  catch (err) {
    console.error(err);
    callback(err);
  }
};

function generateDocumentId(toNumberWithCountry) {
  return `CallbackRequest_${toNumberWithCountry}`;
}

async function sendSMS(client, service, doc, toNumberWithCountry, from) {
  const englishMessage = "UNHCR Call Centre. We have recorded your information and will call back when a staff member is available. Please call again tomorrow if you do not hear from us";
  const arabicMessage = "UNHCR.لقد تم تسجيل معلوماتك وسيقوم احد موظفينا بالتواصل معك بأقرب وقت";
  const message = doc.data.languageChoice === "English" ? englishMessage : arabicMessage;

  //send an sms
  await client.messages.create({
    body: message,
    from,
    to: toNumberWithCountry
  });
  //update item in sync with hassentsms to be true
  doc.data.hasSentSMS = true;
  await service
    .documents(generateDocumentId(toNumberWithCountry)).update({
      data: doc.data
    });
}

async function createOrUpdateCaller(service, toNumberWithCountry, callerId) {
  let doc;
  try {
    doc = await service.documents(generateDocumentId(toNumberWithCountry)).fetch();
  } catch (err) {
    if (err.status === 404) {
      //doc does not exist, create it now
      doc = await createDocumentAsync(service, toNumberWithCountry, callerId);
      return doc; //done, return now
    } else {
      throw err;
    }
  }

  if (!doc) {
    throw new Error("failed to find / create doc");
  }

  //did not create new, so need to update
  var now = new Date();
  if (doc.dateExpires < now) {
    //expired, delete & recreate
    await service.documents(generateDocumentId(toNumberWithCountry)).remove();
    doc = await createDocumentAsync(service, toNumberWithCountry, callerId);
  } else {
    //update existing
    let done = false;
    let retryCount = 0;
    do {
      if (retryCount > 0) {
        doc = await service.documents(generateDocumentId(toNumberWithCountry)).fetch();
      }
      try {
        doc.data.attempts += 1;
        doc = await service.documents(generateDocumentId(toNumberWithCountry)).update({
          data: doc.data,
          ifMatch: doc.revision
        });
        done = true;
      } catch (err) {
        if (retryCount > 3) {
          throw err;
        }
        retryCount += 1;
      }
    } while (!done);

    if (doc.data.mapId && doc.data.mapItemId) {
      //finally, if linked to map item, update count on it as well
      try {
        const mapItem = await service.syncMaps(doc.data.mapId).syncMapItems(doc.data.mapItemId).fetch();
        mapItem.data.attempts = doc.data.attempts;
        service.syncMaps(doc.data.mapId).syncMapItems(doc.data.mapItemId).update({
          data: mapItem.data,
          ifMatch: mapItem.revision
        });
      } catch (err) {
        console.error("failed to update mapItem");
        console.error(err);
      }
    }
  }
  return doc;
}

function createDocumentAsync(service, toNumberWithCountry, callerId) {
  var now = new Date();
  var nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 0);
  var msUntilMidnight = nextMidnight.getTime() - now.getTime() + 1000;
  var secUntilMidnight = msUntilMidnight / 1000;
  secUntilMidnight = Math.ceil(secUntilMidnight);

  return service.documents.create({
    uniqueName: generateDocumentId(toNumberWithCountry),
    data: {
      initialCallDate: now.toISOString(),
      expiryDate: nextMidnight.toISOString(),
      phoneNumber: toNumberWithCountry,
      callerId,
      attempts: 1,
      goneThroughIVR: false,
      hasSentSMS: false,
      mapId: "",
      mapItemId: ""
    },
    ttl: secUntilMidnight
  });
} 