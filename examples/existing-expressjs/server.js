const express = require("express");
const waBackend = require("../../dist/main");

const app = express();

app.get("/restofmyapp", function(req, res) {
  res.send("Rest Of My App");
});

waBackend({
  mongoURL: 'mongodb://yourdbpath',
  dataRequirements: {
    User: {
      title: { type: String },
      content: { type: String }
    }
  },
  gqlMiddleware: (req, res, next) => {
    req.user = {
      name: "sarmad"
    };
    req.permissions = {
      User: { canView: true, canRemove: false, canUpdate: false }
    };
    next();
  },
  app: app
}).run();
