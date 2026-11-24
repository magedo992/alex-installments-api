function createCustomerController(customerService) {
  async function create(req, res) {
    try {
      const { branch_id, name, phones, address, risk_level, general_note } = req.body || {};
      const userBranch = req.user?.branch_id ?? req.user?.branchId;

      let effectiveBranchId;
      if (userBranch !== null && userBranch !== undefined) {
        effectiveBranchId = Number(userBranch);
      } else {
        if (!branch_id) {
          return res.status(400).json({
            success: false,
            message: 'حقل الفرع (branch_id) إلزامي للمستخدمين غير المرتبطين بفرع محدد',
          });
        }
        effectiveBranchId = Number(branch_id);
      }

      if (!effectiveBranchId || isNaN(effectiveBranchId) || effectiveBranchId <= 0) {
        return res.status(400).json({
          success: false,
          message: 'معرف الفرع غير صالح ويجب أن يكون رقماً صحيحاً موجباً',
        });
      }

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'اسم العميل إلزامي',
        });
      }

      const result = await customerService.createCustomer({
        branch_id: effectiveBranchId,
        name,
        phones,
        address,
        risk_level,
        general_note,
      });

      return res.status(201).json({
        success: true,
        message: 'تم إضافة العميل وتوليد الكود بنجاح',
        data: result,
      });
    } catch (error) {
      console.error('[CustomerController] Create error:', error);
      const isClientError = error.message.includes('مطلوب') || error.message.includes('غير موجود');
      return res.status(isClientError ? 400 : 500).json({
        success: false,
        message: error.message || 'حدث خطأ غير متوقع أثناء إضافة العميل',
      });
    }
  }

  async function search(req, res) {
    try {
      const { q, page, limit } = req.query;
      const result = await customerService.searchCustomers({ q, page, limit });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[CustomerController] Search error:', error);
      return res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء البحث عن العملاء',
      });
    }
  }

  return {
    create,
    search,
  };
}

module.exports = {
  createCustomerController,
};
