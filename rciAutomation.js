// ----- Set up -----
const sql = require("mssql");
const nodemailer = require("nodemailer");
const moment = require("moment");

let now = moment();
let today = now.format("MM/DD/YYYY");
let endOfLastMonth = now
  .add(0, "month")
  .date(0)
  .format("MM/DD/YYYY");
let midMonth = moment()
  .set("date", 15)
  .format("MM/DD/YYYY");
let lastDayOfThisMonth = moment()
  .endOf("month")
  .format("MM/DD/YYYY");
let rciDate =  today <= moment().set("date", 15).format("MM/DD/YYYY") ? moment().set("date", 15).format("MM/DD/YYYY") : moment().endOf("month").format("MM/DD/YYYY");

//Set up SQL connection
const config = {
  user: "sa",
  password: "password",
  server: "localhost",
  database: "db"
};


// create reusable transporter object using the default SMTP transport
let transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: "test", // generated ethereal user
    pass: "test" // generated ethereal password
  }
});

let mainPool = new sql.ConnectionPool(config);
let mainPoolConnect = mainPool.connect();

mainPool.on("error", err => {
  console.log(err);
  if (err) {
    let mailOptions = {
      from: '"The Metro Group Inc." <auto-mail@metrogroupinc.com>', // sender address
      to: "pdflog@metrogroupinc.com", // list of receivers
      subject: "Connection to DB has failed", // Subject line
      cc: "",
      html: `<strong>Attention!!</strong> Connection Failed!!!<br />Error:  ${err.message}` // html body
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log(error);
        fs.open("log.txt", "a", 666, (err, id) => {
          if (err) {
            console.log(err);
          }
          fs.write(
            id,
            ` ${new Date()} - ERROR: ${err} \r\n`,
            null,
            "utf8",
            () => {
              fs.close(id, () => {});
            }
          );
        });
      }
    });
  }
});

async function AutoRCIRun() {
  await mainPoolConnect; //checks if pool is connected
  try {
    let req = mainPool.request();
    let results = await req.query(
      "SELECT [MetroBase].ufnGetGenDate() AS genDate"
    );
    if (results.rowsAffected > 0) {
      if (moment(results.recordset[0].genDate).format("MM/DD/YYYY") != endOfLastMonth) {
        try {
          // Running Boston RCI
          console.log("Running RCI");
          let req = mainPool.request();
          req.input("InvDate", sql.Date, rciDate);
          req.input("CSTAMP", sql.VarChar, `AUTORCI${moment().format("YYYYMMDD")}`);
          console.time();
          let monthlyBillingProcessResults = await req.execute(
            "[MetroBase].[uspMonthlyBillingProcess]"
          );
          if (monthlyBillingProcessResults) {
            console.timeEnd();
            console.log("Boston RCI Complete!");

            // Running Back Bill
            console.log("Running Back Bill");
            let req = mainPool.request();
            req.input("InvDate", sql.Date, rciDate);
            req.input(
              "CSTAMP",
              sql.VarChar,
              `AUTORCI${moment().format("YYYYMMDD")}`
            );
            console.time();
            let backBillResults = await req.execute(
              "[MetroBase].[uspProcessBackBilling]"
            );
            if (backBillResults) {
              console.timeEnd();
              console.log("Back Bill RCI Complete!");

              // Running NYC RCI
              console.log("Running NYC RCI");
              let req = mainPool.request();
              req.input("dt", sql.Date, rciDate);
              req.input(
                "CSTAMP",
                sql.VarChar,
                `AUTORCI${moment().format("YYYYMMDD")}`
              );
              console.time();
              let nycRCI = await req.execute(
                "[MetroBase].[uspRunContractInvoicingProcess]"
              );
              if (nycRCI) {
                console.timeEnd();
                console.log("NYC RCI Complete!");

                //Select invoices that email out
                let req = mainPool.request();
                // let invoicesToEmailResults = await req.query(
                //   `SELECT DISTINCT MRCSHH.ID_PK FROM MRCSHH LEFT JOIN MRCUST ON MRCUST.CUST_ID = MRCSHH.CUST_ID AND MRCUST.IsDeleted = 0 LEFT JOIN MREMAILS ON MRCUST.CUST_ID = MREMAILS.CUST_ID and isnull(mremails.billing,0) = 1 and mremails.IsDeleted = 0 WHERE (CAST(GEN_DT AS DATE) = (SELECT [MetroBase].ufnGetGenDate()))  AND INV_PRT_FL <> 1 AND (ISNULL(PRINT_INVOICES,0) <> 1 and isnull(mremails.billing,0) = 1) `
                // );
                 let invoicesToEmailResults = await req.query(
                  `SELECT DISTINCT MRCSHH.ID_PK FROM MRCSHH LEFT JOIN MRCUST ON MRCUST.CUST_ID = MRCSHH.CUST_ID AND MRCUST.IsDeleted = 0 LEFT JOIN MREMAILS ON MRCUST.CUST_ID = MREMAILS.CUST_ID and isnull(mremails.billing,0) = 1 and mremails.IsDeleted = 0 WHERE INV_PRT_FL <> 1 AND (ISNULL(PRINT_INVOICES,0) <> 1 and isnull(mremails.billing,0) = 1) `
                );
                if (invoicesToEmailResults.rowsAffected > 0) {
                  let ids = Object.keys(invoicesToEmailResults.recordset)
                    .map(function(k) {
                      return invoicesToEmailResults.recordset[k].ID_PK;
                    })
                    .join(",");
                    console.log(
                      `${invoicesToEmailResults.rowsAffected} invoices to update`
                    );

                  //update invoice print flag
                  let req = mainPool.request();
                  let updateInvoiceResults = await req.query(
                    `UPDATE MRCSHH SET INV_PRT_FL = 1 WHERE ID_PK in (${ids})`
                  );
                  if (updateInvoiceResults.rowsAffected > 0) {
                    console.log(
                      `Update Complete - ${updateInvoiceResults.rowsAffected} invoices updated`
                    );
                    mainPool.close();
                  }
                  else{
                    mainPool.close();
                  }
                }
              }
            }
          }
        } catch (err) {
          console.log(err);
          if (err) {
            let mailOptions = {
              from: '"The Metro Group Inc." <auto-mail@metrogroupinc.com>', // sender address
              to: 'pdflog@metrogroupinc.com', // list of receivers
              subject: 'RCI Failed ', // Subject line
              cc: '',
              html: `<strong>Attention!!</strong> RCI has failed to run<br />Error:  ${err.message}` // html body
            };
            transporter.sendMail(mailOptions, (error, info) => {
              if (error) {
                console.log(error);
                fs.open('log.txt', 'a', 666, (err, id) => {
                  if (err) {
                    console.log(err);
                  }
                  fs.write(id, ` ${new Date()} - ERROR: ${err} \r\n`, null, 'utf8', () => {
                    fs.close(id, () => {

                    })
                  })
                })
              }
            });
          }
        }
      } else {
        console.log(results.recordset[0].genDate);
        console.log(today);
        console.log("System Gen Date is currently set to last month");
        mainPool.close();
      }
    } else {
      mainPool.close();
    }
  } catch (err) {
    console.log(err);
    if (err) {
      let mailOptions = {
        from: '"The Metro Group Inc." <auto-mail@metrogroupinc.com>', // sender address
        to: 'pdflog@metrogroupinc.com', // list of receivers
        subject: 'Connection to DB has failed', // Subject line
        cc: '',
        html: `<strong>Attention!!</strong> Connection Failed!!!<br />Error:  ${err.message}` // html body
      };
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.log(error);
          fs.open('log.txt', 'a', 666, (err, id) => {
            if (err) {
              console.log(err);
            }
            fs.write(id, ` ${new Date()} - ERROR: ${err} \r\n`, null, 'utf8', () => {
              fs.close(id, () => {

              })
            })
          })
        }
      });
    }
  }
}

AutoRCIRun();
