const express = require('express');
const { createSaleService } = require('../service/sale.service');
const { createSaleController } = require('../controller/sale.controller');
const {
  validate,
  createSaleSchema,
  searchSalesSchema,
  saleDetailsParamsSchema,
  saleByInvoiceParamsSchema,
  recordPaymentSchema,
  overdueSalesSchema,
  followUpSalesSchema,
  addNoteSchema,
} = require('../middlewares/validate.middleware');

function createSaleRoutes(pool, protect) {
  const router = express.Router();
  const service = createSaleService(pool);
  const controller = createSaleController(service);

  router.use(express.json());

  router.get('/', protect, validate(searchSalesSchema, 'query'), controller.search);
  router.post('/', protect, validate(createSaleSchema), controller.create);
  router.post('/:id/payments', protect, validate(recordPaymentSchema), controller.recordPayment);
  router.get('/overdue', protect, validate(overdueSalesSchema, 'query'), controller.getOverdue);
  router.get('/follow-up', protect, validate(followUpSalesSchema, 'query'), controller.getFollowUp);
  router.get('/by-invoice/:invoice_number', protect, validate(saleByInvoiceParamsSchema, 'params'), controller.getOne);
  router.get('/:id', protect, validate(saleDetailsParamsSchema, 'params'), controller.getOne);
  router.post('/:id/notes', protect, validate(addNoteSchema), controller.addNote);

  return router;
}

module.exports = {
  createSaleRoutes,
};
