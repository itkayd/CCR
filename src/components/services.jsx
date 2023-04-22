
import service_image from '../assest/img/service.jpeg'
const Services = () => {
  return (
    <div id="content" >
      <div id="svc" style={{ padding: "8px" }}>
        
        <div className="d-flex justify-content-center">
          <img src={service_image} style={{ width:'50%' , height:'auto' }} alt="React Image" />
        </div>

        <h1>Services</h1>
        {/* title */}
        <div style={{ fontSize: '18px' }}>
          We offer the following <b>professional commercial  <br /> cleaning</b> services:
        </div>


        <div className="d-flex justify-content-center mt-4 row" style={{ fontSize: '15px' }}>
          <div className="col d-flex justify-content-center">
            <ul>
              <li className="fw-bold">Regular office cleaning</li>
              <li className="fw-bold">Carpet cleaning & Upholstery</li>
              <li className="fw-bold">Rug cleaning</li>
              <li>Sport Cleaning</li>
              <li>Deep Cleaning</li>
              <li className="fw-bold">Communal Areas cleaning</li>
            </ul>
          </div>
          <div className="col d-flex justify-content-center">
            <ul>
                <li className="fw-bold">Floor Polishing</li>
                <li className="fw-bold">Floor Scrubbing</li>
                <li className="fw-bold">Floor Stripping</li>
                <li className="fw-bold">Floor Sealing</li>
                <li className="fw-bold">Car Park cleaning</li>
                <li className="fw-bold">Education Centres , Business <br /> units , Factories & shops cleaning</li>
              </ul>
          </div>
        </div>
    
        <div className="mt-4" style={{ fontSize: '18px' }}>
          <div>
            Through our experience, ability and drive, we are determined to meet our clients' expectations. We have <br /> experience in all aspects of carpet cleaning .
          </div>

          <div className="my-4">
            Whatever your type of floor, we can restore it to it's original splendour. We offer scrubbing, stripping , <br /> Sealing and polishing.
          </div>

          <div>
            Whatever you need cleaning, a pub carpet overnight or thousands of square metres of office carpet over a weekend, we have the manpower and equipment to meet your requirements.
          </div>

          <div className="mt-4">
            We offer a free inspection, free consultation, and a free written quotation without obligation.
          </div>
        </div>
        {/* <div align="center">
          <lottie-player
            src="https://assets4.lottiefiles.com/private_files/lf30_kgzAQ8.json"
            background="transparent"
            speed="1"
            style={{ width: "300px", height: "300px" }}
            loop
            autoplay
          ></lottie-player>
        </div> */}
        {/* We offer the following professional commercial cleaning services:

        Regular office cleaningCarpet cleaning & UpholsteryRug cleaningSport CleaningDeep CleaningCommunal Areas cleaningFloor PolishingFloor ScrubbingFloor StrippingFloor SealingCar Park cleaningEducation Centres , Business units , Factories & shops cleaning 

         

        Through our experience, ability and drive, we are determined to meet our clients' expectations. We have experience in all aspects of carpet cleaning .

        Whatever your type of floor, we can restore it to it's original splendour. We offer scrubbing, stripping , Sealing and polishing.

        Whatever you need cleaning, a pub carpet overnight or thousands of square metres of office carpet over a weekend, we have the manpower and equipment to meet your requirements.

        We offer a free inspection, free consultation, and a free written quotation without obligation. */}
        {/* <p>
          We offer the following{" "}
          <strong>professional domestic and commercial cleaning</strong>{" "}
          services:
        </p>
        <table
          width="80%"
          border={0}
          align="center"
          cellPadding={0}
          cellSpacing={0}
        >
          <tbody>
            <tr>
              <td width="50%" align="left" valign="top">
                <ul>
                  <li>
                    <strong>Carpet and floor cleaning</strong>
                  </li>
                  <li>
                    <strong>Upholstery</strong> - We can steam clean and refresh
                    your upholstery or we can use hot water extraction for a
                    deep clean{" "}
                  </li>
                  <li>
                    <strong>Rug cleaning</strong>
                  </li>
                  <li>
                    <strong>Curtains</strong> - We can steam clean your curtain
                    on site or we can take them away for dry cleaning and
                    re-hang them{" "}
                  </li>
                  <li>
                    <strong>Mattresses</strong>
                  </li>
                  <li>
                    <strong>Domestic Cleaning</strong>
                  </li>
                  <li>
                    <strong>Moving in/out cleaning</strong> - let us clean your
                    propery before or after you move in or out{" "}
                  </li>
                  <li>
                    <strong>Communal Areas cleaning</strong>
                  </li>
                  <li>
                    <strong>Landlords</strong>
                  </li>
                </ul>{" "}
              </td>
              <td width="50%" align="left" valign="top">
                <ul>
                  <li>
                    <strong>Car Wash </strong>- don't waste your time taking
                    your car to a carwash, we will come to you
                  </li>
                  <li>
                    <strong>Spring Cleaning</strong>
                  </li>
                  <li>
                    <strong>End of tenancy cleaning</strong>
                  </li>
                  <li>
                    <strong>Computer Cleaning </strong>-helps keep your
                    computer's components in good working condition. Dust and
                    dirt clog cooling fans and cause overheating
                  </li>
                  <li>
                    <strong>Telephone cleaning</strong>
                  </li>
                  <li>
                    <strong>Dish washing</strong>
                  </li>
                  <li>
                    <strong>Car Park cleaning</strong>
                  </li>
                  <li>
                    <strong>Regular office/home cleaning</strong>
                  </li>
                  <li>
                    <strong>carpet and floor cleaning</strong>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
        <p>&nbsp;</p>
        <p>
          Through our experience, ability and drive, we are determined to meet
          our clients' expectations. We have experience in all aspects of carpet
          cleaning.
        </p>
        <p>
          Whatever your type of floor, we can restore it to it's original
          splendour. We offer scrubbing, stripping, and polishing.
        </p>
        <p>
          Whatever you need cleaning, a carpet at home, a pub carpet overnight
          or thousands of square metres of office carpet over a weekend, we have
          the manpower and equipment to meet your requirements.
        </p>
        <p>
          We offer a free inspection, free consultation, and a free written
          quotation without obligation.{" "}
        </p> */}
      </div>
    </div>
  );
};

export default Services;