var telerivet = require('telerivet');
exports.handler = function (context, event, callback) {
    var tr = new telerivet.API(context.TELERIVET_API_KEY);
    var project = tr.initProjectById(context.TELERIVET_PROJECT_ID);

    project.sendMessage({
        content: "hello from twilio",
        to_number: context.TELERIVET_END_USER_NUMBER
    }, function (err, message) {
            console.error('telerivet call failed' + err + message);
    });
}
