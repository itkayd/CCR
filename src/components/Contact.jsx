import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";

const Contact = () => {
  return (
    <div id="content">
      <h1>Contact Us</h1>
      <p className="fs-6 fw-bold">
        If you have any enquiries, please contact us on one of the numbers
        below. Alternatively you can email us at{" "}
        <a href="mailto:enquiries@cleaningcomesfirst.co.uk">
          enquiries@cleaningcomesfirst.co.uk
        </a>{" "}
        or fill out the contact form and our team will get back you
        shortly.
      </p>
       <br />
      <div style={{ color: "#ff0000" }} />
      <Form action="contact.php?return=yes" method="post">
        <Form.Group className="mb-3" controlId="formBasicEmail">
          <Form.Label>Your name</Form.Label>
          <Form.Control type="text" placeholder="Enter Name" name="name" />
        </Form.Group>
        <Form.Group className="mb-3" controlId="formBasicEmail">
          <Form.Label>Your email address</Form.Label>
          <Form.Control type="email" placeholder="Enter Email" name="email" />
        </Form.Group>

        <Form.Group className="mb-3" controlId="formBasicPassword">
          <Form.Label>Your contact telephone number:</Form.Label>
          <Form.Control type="text" placeholder="Enter Phone" name="tel" />
        </Form.Group>
        <Form.Group className="mb-3" controlId="formBasicPassword">
          <Form.Label>Write your message here:</Form.Label>
          <Form.Control as="textarea" rows={3} name="tel" />
        </Form.Group>
        <Button variant="primary" type="submit">
          Send Message
        </Button>
      </Form>
    </div>
  );
};

export default Contact;