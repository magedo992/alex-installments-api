function createSaleController(saleService) {
  async function getOne(req, res) {
    try {
      const result = await saleService.getSaleDetails({
        user: req.user,
        saleId: req.params.id,
        invoiceNumber: req.params.invoice_number,
      });

      if (!result) {
        return res.status(404).json({ success: false, message: 'الفاتورة المحددة غير موجودة' });
      }

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      const status = [400, 403].includes(error.statusCode) ? error.statusCode : 500;
      if (status === 500) console.error('[SaleController] Details error:', error);
      return res.status(status).json({
        success: false,
        message: status === 500 ? 'حدث خطأ أثناء استرجاع تفاصيل الفاتورة' : error.message,
      });
    }
  }

  async function create(req, res) {
    try {
      const result = await saleService.createSale({
        user: req.user,
        saleData: req.body || {},
      });

      return res.status(201).json({
        success: true,
        message: 'تم إنشاء الفاتورة بنجاح',
        data: result,
      });
    } catch (error) {
      console.error('[SaleController] Create error:', error);
      const isClientError =
        error.message.includes('إلزامي') ||
        error.message.includes('غير موجود') ||
        error.message.includes('غير صالح') ||
        error.message.includes('مسجل مسبقاً');

      return res.status(isClientError ? 400 : 500).json({
        success: false,
        message: error.message || 'حدث خطأ غير متوقع أثناء إنشاء الفاتورة',
      });
    }
  }

  async function recordPayment(req, res) {
    try {
      const saleId = req.params.id;
      const { amount, payment_date, payment_method, collection_branch_id, notes } = req.body || {};

      const result = await saleService.recordPayment({
        user: req.user,
        saleId,
        amount,
        paymentDate: payment_date,
        paymentMethod: payment_method,
        collectionBranchId: collection_branch_id,
        notes,
      });

      return res.status(201).json({
        success: true,
        message: 'تم تسجيل الدفعة بنجاح',
        data: result,
      });
    } catch (error) {
      console.error('[SaleController] Payment error:', error);
      const isForbidden = error.statusCode === 403 || error.message.includes('غير مصرح لك');
      const isNotFound = error.message.includes('غير موجودة');
      const isClientError = isNotFound || isForbidden || error.message.includes('غير صالح') || error.message.includes('أكبر من صفر');

      const status = isForbidden ? 403 : isNotFound ? 404 : isClientError ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: error.message || 'حدث خطأ غير متوقع أثناء تسجيل الدفعة',
      });
    }
  }

  async function updateStatus(req, res) {
    try {
      const result = await saleService.updateSaleStatus({
        user: req.user,
        saleId: req.params.id,
        status: req.body?.status,
      });

      return res.status(200).json({
        success: true,
        message: 'تم تحديث حالة الفاتورة بنجاح',
        data: result,
      });
    } catch (error) {
      console.error('[SaleController] UpdateStatus error:', error);
      const isForbidden = error.statusCode === 403 || error.message.includes('غير مصرح لك');
      const isNotFound = error.statusCode === 404 || error.message.includes('غير موجودة');
      const isClientError = isNotFound || isForbidden ||
        error.message.includes('غير صالح') ||
        error.message.includes('لا يمكن تغيير');

      const status = isForbidden ? 403 : isNotFound ? 404 : isClientError ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: status === 500 ? 'حدث خطأ غير متوقع أثناء تحديث حالة الفاتورة' : error.message,
      });
    }
  }

  async function getDailySummary(req, res) {
    try {
      const result = await saleService.getDailySummary({
        user: req.user,
        query: req.query,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[SaleController] DailySummary error:', error);
      const status = error.statusCode || 500;
      return res.status(status).json({
        success: false,
        message: status === 403 ? error.message : 'حدث خطأ أثناء حساب يومية التحصيل',
      });
    }
  }

  async function getOverdue(req, res) {
    try {
      const result = await saleService.getOverdueSales({
        user: req.user,
        query: req.query,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[SaleController] Overdue error:', error);
      return res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء استرجاع قائمة المتأخرات',
      });
    }
  }

  async function addNote(req, res) {
    try {
      const saleId = req.params.id;
      const result = await saleService.addSaleNote({
        user: req.user,
        saleId,
        noteData: req.body,
      });

      return res.status(201).json({
        success: true,
        message: 'تم تسجيل الملاحظة بنجاح',
        data: result,
      });
    } catch (error) {
      console.error('[SaleController] AddNote error:', error);
      const isForbidden = error.statusCode === 403 || error.message.includes('غير مصرح لك');
      const isNotFound = error.message.includes('غير موجودة');
      const isClientError = isNotFound || isForbidden || error.message.includes('إلزامي') || error.message.includes('غير صالح');

      const status = isForbidden ? 403 : isNotFound ? 404 : isClientError ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: error.message || 'حدث خطأ غير متوقع أثناء تسجيل الملاحظة',
      });
    }
  }

  async function search(req, res) {
    try {
      const result = await saleService.searchSales({
        user: req.user,
        query: req.query,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[SaleController] Search error:', error);
      return res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء البحث عن الفواتير',
      });
    }
  }

  async function getFollowUp(req, res) {
    try {
      const result = await saleService.getFollowUpSales({
        user: req.user,
        query: req.query,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[SaleController] FollowUp error:', error);
      const status = error.statusCode || 500;
      return res.status(status).json({
        success: false,
        message: status === 403 ? error.message : 'حدث خطأ أثناء استرجاع قائمة المتابعة',
      });
    }
  }

  return {
    getOne,
    create,
    search,
    recordPayment,
    updateStatus,
    getDailySummary,
    getOverdue,
    getFollowUp,
    addNote,
  };
}

module.exports = {
  createSaleController,
};
