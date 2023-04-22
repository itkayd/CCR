import Logo from "./logo";
import sidebar from "../assest/img/newsbg.jpg";
import Menu from "./Menu";
import { Outlet } from "react-router-dom";
import { useState } from "react";
const Sidebar = () => {
  let [open, setOpen] = useState(false);
  return (
    <>
      <Logo />

      <div className="rows text">
        <div className={`cols-3 sidebar ${open ? "open" : ""}`}>
<span className="close " onClick={() => setOpen(!open)}>X</span>
          {/*           <div className="about-text">About Us</div> */}
          <img style={{ width: "100%" }} src={sidebar} alt="" />
          <p style={{ marginTop: "-550px" , overflow:'hidden' , marginLeft:'20px'}} className="sidebar_menu">
            {/* We are the benchmark provider of cleaning solutions to an impressive
            and comprehensive client base. Through challenging accepted wisdom
            we have changed the shape of the cleaning company providing our
            customers with superior services. As a Cleaning Comes First client
            you will have confidence in your cleaner because we carry out
            rigourous checks on all job applicants to provide you with a cleaner
            who is honest, reliable and competent. At Cleaning Comes First, we
            aim to provide the highest quality service tailored to meet your
            specific requirements, on time, and within your budget. We only use
            the highest quality systems and products to ensure the best possible
            result. At Cleaning Comes First we offer a variety of services that
            suit every need, whether it be in your office, factory, business
            unit or in your own home, we can help you. We place a high value on
            the world around us and rest assured we use environmentally safe
            products and equipment wherever possible without the price premium
            or poor quality often associated with his market sector. We pride
            ourselves on being courteous and professional in all we do. We
            operate in and out of business hours to suit your requirements. We
            cover: Churches Offices Shops Hotels Residential Homes Factories and
            warehouses All our cleaners are vetted and we provide insurance
            cover for accidental damage. Everybody needs a break and with our
            regular weekly service, isn't there something you'd rather be doing */}


            We are the benchmark provider of cleaning solutions to an impressive and comprehensive client base. Through challenging accepted wisdom we have changed the shape of the cleaning company providing our customers with superior services. As a Cleaning Comes First client you will have confidence in your cleaner because we carry out rigorous checks on all job applicants to provide you with a cleaner who is honest, reliable and competent.

            At Cleaning Comes First, we aim to provide the highest quality service tailored to meet your specific requirements, on time, and within your budget.

            We only use the highest quality systems and products to ensure the best possible result. At Cleaning Comes First we offer a variety of services that suit every need, whether it be in your office, factory, business unit , Car park or Education Centre., we can help you.

            We place a high value on the world around us and rest assured we use environmentally safe products and equipment wherever possible without the price premium or poor quality often associated with his market sector.

            We pride ourselves on being courteous and professional in all we do. We operate in and out of business hours to suit your requirements.

            We cover:

            ChurchesOfficesShops and Business unitsHotelsEducation CentresFactories and warehouses

            All our cleaners are vetted and we provide insurance cover for accidental damage.



          </p>
        </div>
        <div className="cols">
          <Menu open={open} setOpen={setOpen} />
          <Outlet />
          {/* <Services /> */}
          {/* <Contact /> */}
        </div>
      </div>
    </>
  );
};

export default Sidebar;
