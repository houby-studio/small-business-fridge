import { Router } from "express";
import moment from "moment";
import User from "../../models/user.js";
import { ensureAuthenticated } from "../../functions/ensureAuthenticated.js";
import { checkKiosk } from "../../functions/checkKiosk.js";
import logger from "../../functions/logger.js";
var router = Router();
moment.locale("cs");

/* GET users page. */
router.get("/", ensureAuthenticated, checkKiosk, function (req, res) {
  if (!req.user.admin) {
    logger.warn(
      `server.routes.adminusers.get__User tried to access admin page without permission.`,
      {
        metadata: {
          result: req.user,
        },
      }
    );
    res.redirect("/");
    return;
  }

  if (req.session.alert) {
    var alert = req.session.alert;
    delete req.session.alert;
  }
  User.find()
    .then((docs) => {
      if (docs) {
        logger.debug(
          `server.routes.adminusers.get__Successfully loaded ${docs.length} users.`,
          {
            metadata: {
              result: docs,
            },
          }
        );
      }

      res.render("admin/admin_users", {
        title: "Uživatelé | Lednice IT",
        users: docs,
        alert: alert,
        user: req.user,
      });
    })
    .catch((err) => {
      logger.error(`server.routes.adminusers.get__Failed to load users.`, {
        metadata: {
          error: err.message,
        },
      });
    });
});

export default router;
