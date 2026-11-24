const express = require('express');
const { createCustomerService } = require('../service/customer.service');
const { createCustomerController } = require('../controller/customer.controller');
const { validate, createCustomerSchema, searchCustomerSchema } = require('../middlewares/validate.middleware');

function createCustomerRoutes(pool, protect) {
  const router = express.Router();
  const service = createCustomerService(pool);
  const controller = createCustomerController(service);

  router.use(express.json());

  router.post('/', protect, validate(createCustomerSchema), controller.create);
  router.get('/', protect, validate(searchCustomerSchema, 'query'), controller.search);

  return router;
}

module.exports = {
  createCustomerRoutes,
};
